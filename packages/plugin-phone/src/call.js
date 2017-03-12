/**!
 *
 * Copyright (c) 2016 Cisco Systems, Inc. See LICENSE file.
 * @private
 */

/* eslint-env browser: true */
/* global RTCPeerConnection, RTCSessionDescription */

import {SparkPlugin} from '@ciscospark/spark-core';
import {base64, oneFlight, retry, tap} from '@ciscospark/common';
import {
  USE_INCOMING,
  FETCH
} from '@ciscospark/plugin-locus';
import {debounce, defaults, find, get, set} from 'lodash';
import {
  activeParticipants,
  direction,
  isActive,
  joined,
  joinedOnThisDevice,
  participantIsJoined,
  remoteAudioMuted,
  remoteParticipant,
  remoteVideoMuted
} from './state-parsers';
import boolToStatus from './bool-to-status';

import WebRTCMedia from './web-rtc-media';
import uuid from 'uuid';

/**
 * @event ringing
 * @instance
 * @memberof Call
 */

/**
 * @event connected
 * @instance
 * @memberof Call
 */

/**
 * @event disconnected
 * @instance
 * @memberof Call
 */

/**
 * @event localMediaStream:change
 * @instance
 * @memberof Call
 */

/**
 * @event remoteMediaStream:change
 * @instance
 * @memberof Call
 */

/**
 * @event error
 * @instance
 * @memberof Call
 */

/**
 * Payload for {@link Call#sendFeedback}
 * @typedef {Object} Types~Feedback
 * @property {number} userRating Number between 1 and 5 (5 being best) to let
 * the user score the call
 * @property {string} userComments Freeform feedback from the user about the
 * call
 * @property {Boolean} includeLogs set to true to submit client logs to the
 * Cisco Spark cloud. Note: at this time, all logs, not just call logs,
 * generated by the sdk will be uploaded to the Spark Cloud. Care has been taken
 * to avoid including PII in these logs, but if you've taken advantage of the
 * SDK's logger, you should make sure to avoid logging PII as well.
 */

/**
 * @class
 * @extends SparkPlugin
 */
const Call = SparkPlugin.extend({
  namespace: `Phone`,

  children: {
    media: WebRTCMedia
  },

  session: {
    correlationId: `string`,
    /**
     * @instance
     * @memberof Call
     * @type {string}
     * @readonly
     */
    facingMode: {
      type: `string`,
      values: [`user`, `environment`]
    },
    locus: `object`,
    /**
     * Returns the local MediaStream for the call. May initially be `null`
     * between the time @{Phone#dial is invoked and the  media stream is
     * acquired if {@link Phone#dial} is invoked without a `localMediaStream`
     * option.
     *
     * This property can also be set mid-call in which case the streams sent to
     * the remote party are replaced by this stream. On success, the
     * {@link Call}'s {@link localMediaStream:change} event fires, notifying any
     * listeners that we are now sending media from a new source.
     * @instance
     * @memberof Call
     * @type {MediaStream}
     */
    localMediaStream: `object`,
    /**
     * Object URL that refers to {@link Call#localMediaStream}. Will be
     * automatically deallocated when the call ends
     * @instance
     * @memberof Call
     * @type {string}
     * @readonly
     */
    localMediaStreamUrl: `string`,
    /**
     * Object URL that refers to {@link Call#remoteMediaStream}. Will be
     * automatically deallocated when the call ends
     * @instance
     * @memberof Call
     * @type {string}
     * @readonly
     */
    remoteMediaStreamUrl: `string`
  },

  // Note, in its current form, any derived property that is an object will emit
  // a change event everytime a locus gets replaced, even if no values change.
  // For the moment, this is probably ok; once we have multi-party, regular
  // change events on activeParticipants may be a problem.
  derived: {
    id: {
      deps: [`locus`],
      fn() {
        return this.locus && this.locus.url;
      }
    },
    isActive: {
      deps: [`locus`],
      fn() {
        return this.locus && isActive(this.locus);
      }
    },
    activeParticipants: {
      deps: [`locus`],
      fn() {
        return activeParticipants(this.locus);
      }
    },
    activeParticipantsCount: {
      deps: [`activeParticipants`],
      fn() {
        return this.activeParticipants.length;
      }
    },
    joined: {
      deps: [`locus`],
      default: false,
      fn() {
        return this.locus && joined(this.locus);
      }
    },
    joinedOnThisDevice: {
      deps: [`locus`],
      default: false,
      fn() {
        return this.locus && joinedOnThisDevice(this.spark, this.locus);
      }
    },
    locusUrl: {
      deps: [`locus`],
      fn() {
        return this.locus.url;
      }
    },
    device: {
      deps: [`locus`],
      fn() {
        return this.locus.self && find(this.locus.self.devices, (item) => item.url === this.spark.device.url);
      }
    },
    mediaConnection: {
      deps: [`device`],
      fn() {
        return this.device && this.device.mediaConnections && this.device.mediaConnections[0];
      }
    },
    mediaId: {
      deps: [`mediaConnection`],
      fn() {
        return this.mediaConnection && this.mediaConnection.mediaId;
      }
    },
    remoteAudioMuted: {
      deps: [`remote`],
      fn() {
        return remoteAudioMuted(this.remote);
      }
    },
    remoteVideoMuted: {
      deps: [`remote`],
      fn() {
        return remoteVideoMuted(this.remote);
      }
    },
    direction: {
      deps: [`locus`],
      fn() {
        // This seems brittle, but I can't come up with a better way. The only
        // way we should have a Call without a locus is if we just initiated a
        // call but haven't got the response from locus yet.
        if (!this.locus) {
          return `out`;
        }
        return direction(this.locus);
      }
    },
    from: {
      deps: [
        `direction`,
        `local`,
        `remote`
      ],
      fn() {
        return this.direction === `out` ? this.local : this.remote;
      }
    },
    to: {
      deps: [
        `direction`,
        `local`,
        `remote`
      ],
      fn() {
        return this.direction === `in` ? this.local : this.remote;
      }
    },
    local: {
      deps: [`locus`],
      fn() {
        return this.locus && this.locus.self;
      }
    },
    remote: {
      deps: [`locus`],
      fn() {
        return this.locus && remoteParticipant(this.locus);
      }
    },
    /**
     * <b>initiated</b> - Offer was sent to remote party but they have not yet accepted <br>
     * <b>ringing</b> - Remote party has acknowledged the call <br>
     * <b>connected</b> - At least one party is still on the call <br>
     * <b>disconnected</b> - All parties have dropped <br>
     * @instance
     * @memberof Call
     * @member {string}
     * @readonly
     */
    status: {
      deps: [
        `joinedOnThisDevice`,
        `local`,
        `remote`
      ],
      fn() {
        if (this.joinedOnThisDevice && this.remote && participantIsJoined(this.remote)) {
          return `connected`;
        }

        if (this.remote && this.local) {
          if (this.remote.state === `LEFT` || this.local.state === `LEFT`) {
            return `disconnected`;
          }

          if (this.remote.state === `DECLINED`) {
            return `disconnected`;
          }

          if (this.remote.state === `NOTIFIED`) {
            return `ringing`;
          }
        }

        return `initiated`;
      }
    },
    /**
     * Access to the remote party’s `MediaStream`.
     * @instance
     * @memberof Call
     * @member {MediaStream}
     * @readonly
     */
    remoteMediaStream: {
      deps: [`media.remoteMediaStream`],
      fn() {
        return this.media.remoteMediaStream;
      }
    },
    receivingAudio: {
      deps: [`media.receivingAudio`],
      fn() {
        return this.media.receivingAudio;
      }
    },
    receivingVideo: {
      deps: [`media.receivingVideo`],
      fn() {
        return this.media.receivingVideo;
      }
    },
    sendingAudio: {
      deps: [`media.sendingAudio`],
      fn() {
        return this.media.sendingAudio;
      }
    },
    sendingVideo: {
      deps: [`media.sendingVideo`],
      fn() {
        return this.media.sendingVideo;
      }
    }
  },

  /**
   * Initializer
   * @private
   * @param {Object} attrs
   * @param {Object} options
   * @returns {undefined}
   */
  initialize(...args) {
    Reflect.apply(SparkPlugin.prototype.initialize, this, args);

    this.listenTo(this.spark.mercury, `event:locus`, (event) => this._onLocusEvent(event));
    this.listenTo(this.media, `error`, (error) => this.trigger(`error`, error));
    this.on(`disconnected`, () => {
      this.stopListening(this.spark.mercury);
      this.off();
      URL.revokeObjectURL(this.localMediaStreamUrl);
      this.localMediaStreamUrl = undefined;
      URL.revokeObjectURL(this.remoteMediaStreamUrl);
      this.remoteMediaStreamUrl = undefined;
    });

    this.listenTo(this.media, `negotiationneeded`, debounce(() => {
      this.media.createOffer()
        .then((offer) => this.spark.locus.updateMedia(this.locus, {
          sdp: offer,
          mediaId: this.mediaId
        }))
        .then(() => this._fetchExpectedLocus())
        .then((locus) => {
          this._setLocus(locus);
          const sdp = JSON.parse(this.mediaConnection.remoteSdp).sdp;
          return this.media.acceptAnswer(sdp);
        })
        .catch((reason) => this.emit(`error`, reason));
    }));

    this.on(`change:remoteMediaStream`, () => {
      if (this.remoteMediaStreamUrl) {
        URL.revokeObjectURL(this.remoteMediaStreamUrl);
      }
      if (this.remoteMediaStream) {
        this.remoteMediaStreamUrl = URL.createObjectURL(this.remoteMediaStream);
      }
      else {
        this.unset(`remoteMediaStreamUrl`);
      }
    });

    // Reminder: this is not a derived property so that we can reassign the
    // stream midcall
    this.on(`change:media.localMediaStream`, () => {
      this.localMediaStream = this.media.localMediaStream;
      if (this.localMediaStreamUrl) {
        URL.revokeObjectURL(this.localMediaStreamUrl);
      }
      if (this.localMediaStream) {
        this.localMediaStreamUrl = URL.createObjectURL(this.localMediaStream);
      }
      else {
        this.unset(`localMediaStreamUrl`);
      }
    });

    this.on(`change:localMediaStream`, () => {
      if (this.media.localMediaStream !== this.localMediaStream) {
        this.media.localMediaStream = this.localMediaStream;
      }


      if (this.facingMode) {
        const mode = get(this, `media.videoConstraint.facingMode.exact`);
        if (mode === `user`) {
          this.facingMode = `user`;
        }

        if (mode === `environment`) {
          this.facingMode = `environment`;
        }
      }
    });

    [
      `remoteMediaStream`,
      `remoteMediaStreamUrl`,
      `localMediaStream`,
      `localMediaStreamUrl`,
      `remoteAudioMuted`,
      `remoteVideoMuted`
    ].forEach((key) => {
      this.on(`change:${key}`, () => this.trigger(`${key}:change`));
    });

    // This handler is untested because there's no way to provoke it. It's
    // probably actually only relevant for group calls.
    this.on(`change:isActive`, () => {
      if (!this.isActive) {
        if (this.joinedOnThisDevice) {
          this.logger.info(`call: hanging up due to locus going inactive`);
          this.hangup();
        }
      }
    });

    this.on(`change:activeParticipantsCount`, () => {
      const previousLocus = this.previousAttributes().locus;
      if (this.joinedOnThisDevice && this.activeParticipantsCount === 1 && previousLocus && activeParticipants(previousLocus).length > 1) {
        this.logger.info(`call: hanging up due to last participant in call`);
        this.hangup();
      }
    });

    this.on(`change:status`, () => {
      switch (this.status) {
      case `ringing`:
        this.trigger(`ringing`);
        break;
      case `connected`:
        this.trigger(`connected`);
        break;
      case `disconnected`:
        this.trigger(`disconnected`);
        break;
      default:
        // do nothing
      }
    });
  },

  /**
   * Answers an incoming call. Only applies to incoming calls. Invoking this
   * method on an outgoing call is a noop
   * @instance
   * @memberof Call
   * @param {Object} options
   * @param {MediaStreamConstraints} options.constraints
   * @returns {Promise}
   */
  answer(options) {
    this.logger.info(`call: answering`);
    if (!this.locus || this.direction === `out`) {
      return Promise.resolve();
    }
    // Locus may think we're joined on this device if we e.g. reload the page,
    // so, we need to check if we also have a working peer connection
    if (this.joinedOnThisDevice && this.media.peer) {
      this.logger.info(`call: already joined on this device`);
      return Promise.resolve();
    }
    return this._join(`join`, this.locus, options)
      .then(tap(() => this.logger.info(`call: answered`)));
  },

  /**
   * Use to acknowledge (without answering) an incoming call. Will cause the
   * initiator's Call instance to emit the ringing event.
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  acknowledge() {
    this.logger.info(`call: acknowledging`);
    return this.spark.locus.alert(this.locus)
      .then((locus) => this._setLocus(locus))
      .then(tap(() => this.logger.info(`call: acknowledged`)));
  },

  /**
   * Used by {@link Phone#dial} to initiate an outbound call
   * @instance
   * @memberof Call
   * @param {[type]} invitee
   * @param {[type]} options
   * @private
   * @returns {[type]}
   */
  dial(invitee, options) {
    this.logger.info(`call: dialing`);
    if (options && options.localMediaStream) {
      this.localMediaStream = options.localMediaStream;
    }

    if (base64.validate(invitee)) {
      // eslint-disable-next-line no-unused-vars
      const parsed = base64.decode(invitee).split(`/`);
      const resourceType = parsed[3];
      const id = parsed[4];
      if (resourceType === `PEOPLE`) {
        invitee = id;
      }
    }

    this.spark.phone.register()
      .then(() => this._join(`create`, invitee, options))
      .then(tap(() => this.logger.info(`call: dialed`)))
      .catch((reason) => {
        this.trigger(`error`, reason);
      });

    return this;
  },

  /**
   * Disconnects the active call. Applies to both incoming and outgoing calls.
   * This method may be invoked in any call state and the SDK should take care
   * to tear down the call and free up all resources regardless of the state.
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  hangup() {
    if (this.direction === `in` && !this.joinedOnThisDevice) {
      return this.reject();
    }

    this.logger.info(`call: hanging up`);

    this.media.end();

    if (!this.locus) {
      if (this.locusJoinInFlight) {
        this.logger.info(`call: no locus, waiting for rest call to complete before hanging up`);
        return this.when(`change:locus`)
          .then(() => this.hangup());
      }

      this.stopListening(this.spark.mercury);
      this.off();
      this.logger.info(`call: hang up complete, call never created`);
      return Promise.resolve();
    }

    return this._hangup();
  },

  /**
   * Does the internal work necessary to end a call while allowing hangup() to
   * call itself without getting stuck in promise change because of oneFlight
   * @private
   * @returns {Promise}
   */
  @oneFlight
  _hangup() {
    this.locusLeaveInFlight = true;
    return this.spark.locus.leave(this.locus)
      .then((locus) => this._setLocus(locus))
      .then(() => {
        this.locusLeaveInFlight = false;
      })
      .then(tap(() => this.stopListening(this.spark.mercury)))
      .then(tap(() => this.off()))
      .then(tap(() => this.logger.info(`call: hung up`)));
  },

  /**
   * Alias of {@link Call#reject}
   * @see {@link Call#reject}
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  decline() {
    return this.reject();
  },

  /**
   * Rejects an incoming call. Only applies to incoming calls. Invoking this
   * method on an outgoing call is a no-op.
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  @oneFlight
  reject() {
    if (this.direction === `out`) {
      return Promise.resolve();
    }

    this.logger.info(`call: rejecting`);
    /* eslint no-invalid-this: [0] */
    return this.spark.locus.decline(this.locus)
      .then((locus) => this._setLocus(locus))
      .then(tap(() => this.stopListening(this.spark.mercury)))
      .then(tap(() => this.off()))
      .then(tap(() => this.logger.info(`call: rejected`)));
  },

  /**
   * Replaces the current mediaStrem with one with identical constraints, except
   * for an opposite facing mode. If the current facing mode cannot be
   * determined, the facing mode will be set to `user`. If the call is audio
   * only, this function will throw.
   * @returns {undefined}
   */
  toggleFacingMode() {
    const constraints = {
      audio: Object.assign({}, this.media.audioConstraint),
      video: this.media.videoConstraint
    };

    if (!constraints.video) {
      throw new Error(`Cannot toggle facignMode on audio-only call`);
    }

    if (this.facingMode !== `user` && this.facingMode !== `environment`) {
      throw new Error(`Cannot determine current facing mode; specify a new localMediaStream to change cameras`);
    }

    if (constraints.video === true) {
      constraints.video = {
        facingMode: {
          exact: this.facingMode
        }
      };
    }

    if (this.facingMode === `user`) {
      set(constraints, `video.facingMode.exact`, `environment`);
    }
    else {
      set(constraints, `video.facingMode.exact`, `user`);
    }

    return this.spark.phone.createLocalMediaStream(constraints)
      .then((stream) => new Promise((resolve) => {
        this.media.once(`answeraccepted`, resolve);
        this.localMediaStream = stream;
      }))
      .then(() => {
        this.facingMode = constraints.video.facingMode.exact;
      });
  },

  /**
   * Starts sending audio to the Cisco Spark Cloud
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  startSendingAudio() {
    return this._changeSendingMedia(`audio`, true);
  },

  /**
   * Starts sending video to the Cisco Spark Cloud
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  startSendingVideo() {
    return this._changeSendingMedia(`video`, true);
  },

  startReceivingAudio() {
    return this._changeReceivingMedia(`offerToReceiveAudio`, true);
  },

  startReceivingVideo() {
    return this._changeReceivingMedia(`offerToReceiveVideo`, true);
  },

  /**
   * Toggles receiving audio from the Cisco Spark Cloud
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  toggleReceivingAudio() {
    return this.receivingAudio ? this.stopReceivingAudio() : this.startReceivingAudio();
  },

  /**
   * Toggles receiving video from the Cisco Spark Cloud
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  toggleReceivingVideo() {
    return this.receivingVideo ? this.stopReceivingVideo() : this.startReceivingVideo();
  },

  stopReceivingAudio() {
    return this._changeReceivingMedia(`offerToReceiveAudio`, false);
  },

  stopReceivingVideo() {
    return this._changeReceivingMedia(`offerToReceiveVideo`, false);
  },

  /**
   * Toggles sending audio to the Cisco Spark Cloud
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  toggleSendingAudio() {
    return this.sendingAudio ? this.stopSendingAudio() : this.startSendingAudio();
  },

  /**
   * Toggles sending video to the Cisco Spark Cloud
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  toggleSendingVideo() {
    return this.sendingVideo ? this.stopSendingVideo() : this.startSendingVideo();
  },

  /**
   * Sends feedback about the call to the Cisco Spark cloud
   * @instance
   * @memberof Call
   * @param {Types~Feedback} feedback
   * @returns {Promise}
   */
  sendFeedback(feedback) {
    return this.spark.metrics.submit(`meetup_call_user_rating`, feedback);
  },

  /**
   * Stops sending audio to the Cisco Spark Cloud. (stops broadcast immediately,
   * even if renegotiation has not completed)
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  stopSendingAudio() {
    return this._changeSendingMedia(`audio`, false);
  },

  /**
   * Stops sending video to the Cisco Spark Cloud. (stops broadcast immediately,
   * even if renegotiation has not completed)
   * @instance
   * @memberof Call
   * @returns {Promise}
   */
  stopSendingVideo() {
    return this._changeSendingMedia(`video`, false);
  },

  _changeSendingMedia(key, value) {
    return new Promise((resolve) => {
      this.once(`change:sending${key === `audio` ? `Audio` : `Video`}`, () => resolve(this._updateSendingMedia()));
      this.media.set(key, value);
    });
  },

  @oneFlight
  _updateSendingMedia() {
    // This method should never send a new sdp; if we performed an action that
    // would cause a new sdp, the onnegotiationneeded handler should exchange
    // it. this means that for a number of scenarios, we must call update media
    // twice.
    return this.spark.locus.updateMedia(this.locus, {
      sdp: this.media.peer.localDescription.sdp,
      mediaId: this.mediaId,
      audioMuted: !this.sendingAudio,
      videoMuted: !this.sendingVideo
    })
    .then(() => this.spark.locus.get(this.locus))
    .then((locus) => this._setLocus(locus));
  },

  // The complexity in _join is largely driven up by fairly readable `||`s
  // eslint-disable-next-line complexity
  _join(locusMethodName, target, options = {}) {
    if (options.localMediaStream) {
      this.media.set(`localMediaStream`, options.localMediaStream);
    }
    else {
      if (!options.constraints) {
        options.constraints = {
          audio: true,
          video: {
            facingMode: {
              exact: this.spark.phone.defaultFacingMode
            }
          }
        };
      }
      const mode = get(options, `constraints.video.facingMode.exact`);
      if (mode === `user` || mode === `environment`) {
        this.facingMode = mode;
      }

      const recvOnly = !options.constraints.audio && !options.constraints.video;
      options.offerOptions = defaults(options.offerOptions, {
        offerToReceiveAudio: recvOnly || !!options.constraints.audio,
        offerToReceiveVideo: recvOnly || !!options.constraints.video
      });

      this.media.set({
        audio: options.constraints.audio,
        video: options.constraints.video,
        offerToReceiveAudio: options.offerOptions.offerToReceiveAudio,
        offerToReceiveVideo: options.offerOptions.offerToReceiveVideo
      });
    }

    if (!target.correlationId) {
      this.correlationId = options.correlationId = uuid.v4();
    }

    if (!this.correlationId) {
      this.correlationId = target.correlationId;
    }

    return this.media.createOffer()
      .then((offer) => this.spark.locus[locusMethodName](target, {
        localSdp: offer,
        correlationId: this.correlationId
      }))
      .then((locus) => {
        this._setLocus(locus);
        this.locusJoinInFlight = false;
        const answer = JSON.parse(this.mediaConnection.remoteSdp).sdp;
        return this.media.acceptAnswer(answer);
      });
  },

  _onLocusEvent(event) {
    const device = find(event.data.locus.self.devices, (item) => item.url === this.spark.device.url);
    if (this.locus && event.data.locus.url === this.locus.url || this.correlationId && this.correlationId === device.correlationId) {
      this.logger.info(`locus event: ${event.data.eventType}`);
      this._setLocus(event.data.locus);
    }
  },

  _setLocus(incoming) {
    const current = this.locus;
    if (!current) {
      this.locus = incoming;
      return Promise.resolve();
    }
    const action = this.spark.locus.compare(current, incoming);

    switch (action) {
    case USE_INCOMING:
      this.locus = incoming;
      // certain reasons for setting a locus (such as from calling
      // acknowledge())
      if (this.device) {
        this.correlationId = this.device.correlationId;
      }
      break;
    case FETCH:
      return this.spark.locus.get(current)
         .then((locus) => this._setLocus(locus));
    default:
      // do nothing
    }

    return Promise.resolve();
  },

  _changeReceivingMedia(key, value) {
    return new Promise((resolve) => {
      this.once(`change:receiving${key === `offerToReceiveAudio` ? `Audio` : `Video`}`, () => resolve());
      this.media.set(key, value);
    });
  },

  /**
   * The response to a PUT to LOCUS/media may not be fully up-to-dat when we
   * receive it. This method polls locus until we get a locus with the status
   * properties we expect (or three errors occur)
   * @returns {Promise<Types~Locus>}
   */
   @retry
  _fetchExpectedLocus() {
    return this.spark.locus.get(this.locus)
      .then((locus) => {
        if (locus.self.status.audioStatus.toLowerCase() !== boolToStatus(this.media.audio, this.media.offerToReceiveAudio)) {
          throw new Error(`locus.self.status.audioStatus indicates the received DTO is out of date`);
        }

        if (locus.self.status.videoStatus.toLowerCase() !== boolToStatus(this.media.video, this.media.offerToReceiveVideo)) {
          throw new Error(`locus.self.status.videoStatus indicates the received DTO is out of date`);
        }

        return locus;
      });
  }
});

Call.make = function make(attrs, options) {
  return new Call(attrs, options);
};

export default Call;
