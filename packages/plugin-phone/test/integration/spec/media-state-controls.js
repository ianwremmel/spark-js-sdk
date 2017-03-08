/**!
 *
 * Copyright (c) 2015-2016 Cisco Systems, Inc. See LICENSE file.
 */

import '../..';

import {assert} from '@ciscospark/test-helper-chai';
import CiscoSpark from '@ciscospark/spark-core';
import testUsers from '@ciscospark/test-helper-test-users';
import handleErrorEvent from '../lib/handle-error-event';

function boolToStatus(sending, receiving) {
  if (sending && receiving) {
    return `sendrecv`;
  }

  if (sending && !receiving) {
    return `sendonly`;
  }

  if (!sending && receiving) {
    return `recvonly`;
  }

  if (!sending && !receiving) {
    return `inactive`;
  }

  throw new Error(`If you see this error, your JavaScript engine has a major flaw`);
}

function assertLocusMediaState(call, {
  sendingAudio,
  sendingVideo,
  receivingAudio,
  receivingVideo
}) {
  // Local State
  assert.equal(call.sendingAudio, sendingAudio, `The call ${sendingAudio ? `is` : `is not`} sending audio`);
  assert.equal(call.sendingVideo, sendingVideo, `The call ${sendingVideo ? `is` : `is not`} sending video`);

  // Locus State
  assert.equal(call.local.status.audioStatus.toLowerCase(), boolToStatus(sendingAudio, receivingAudio), `Locus State`);
  assert.equal(call.local.status.videoStatus.toLowerCase(), boolToStatus(sendingVideo, receivingVideo), `Locus State`);

  // Media State
  assert.equal(call.media.sendingAudio, sendingAudio, `The call's media layer's sendingAudio is ${sendingAudio}`);
  assert.equal(call.media.sendingVideo, sendingVideo, `The call's media layer's sendingVideo is ${sendingVideo}`);
  assert.equal(call.media.receivingAudio, receivingAudio, `The call's media layer's receivingAudio is ${receivingAudio}`);
  assert.equal(call.media.receivingVideo, receivingVideo, `The call's media layer's receivingVideo is ${receivingVideo}`);
}

describe(`plugin-phone`, function() {
  this.timeout(30000);

  describe(`Call`, () => {
    describe(`Media State Controls`, () => {
      /* eslint max-statements: [0] */
      let mccoy, spock;
      // I was getting weird cross talk from sharing the same users across all
      // the tests. I think it was a latency issue on the locus or linus side
      // where not all the cloud pieces were fully aware the previous test's
      // call had ended. As such, it seems necessary to use new users for each
      // test.
      beforeEach(`create caller`, () => testUsers.create({count: 1})
        .then(([user]) => {
          spock = user;
          spock.spark = new CiscoSpark({
            credentials: {
              authorization: spock.token
            }
          });

          return spock.spark.phone.register();
        }));

      beforeEach(`create callee`, () => testUsers.create({count: 1})
        .then(([user]) => {
          mccoy = user;
          mccoy.spark = new CiscoSpark({
            credentials: {
              authorization: mccoy.token
            }
          });

          return mccoy.spark.phone.register();
        }));

      afterEach(() => mccoy && mccoy.spark.phone.deregister()
        .catch((reason) => console.warn(`could not disconnect mccoy from mercury`, reason)));

      afterEach(() => spock && spock.spark.phone.deregister()
        .catch((reason) => console.warn(`could not disconnect spock from mercury`, reason)));

      describe(`#toggleReceivingAudio()`, () => {
        describe(`when the call is started with audio`, () => {
          // TODO [SSDK-544] Work with the Locus and Calliope teams to make
          // SENDONLY audio a valid thing
          it.skip(`stops receiving audio and starts receiving audio`, () => {
            const call = spock.spark.phone.dial(mccoy.email);
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => handleErrorEvent(c, () => c.answer())),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
                .then(() => call.toggleReceivingAudio())
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: false,
                  receivingVideo: true
                }))
                .then(() => call.toggleReceivingAudio()))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
            ]);
          });
        });

        describe(`when the call is started without audio`, () => {
          // TODO [SSDK-544] Work with the Locus and Calliope teams to make
          // SENDONLY audio a valid thing
          it.skip(`starts receiving audio and stops receiving audio`, () => {
            const call = spock.spark.phone.dial(mccoy.email, {
              constraints: {
                video: false
              }
            });
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => handleErrorEvent(c, () => c.answer())),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: false
                }))
                .then(() => call.toggleReceivingAudio())
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: false,
                  receivingVideo: false
                }))
                .then(() => call.toggleReceivingAudio()))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: false
                }))
            ]);
          });
        });
      });

      describe(`#toggleReceivingVideo()`, () => {
        describe(`when the call is started with video`, () => {
          it(`stops receiving video and starts receiving video`, () => {
            const call = spock.spark.phone.dial(mccoy.email);
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => handleErrorEvent(c, () => c.answer())),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
                .then(() => call.toggleReceivingVideo())
                .then(() => new Promise((resolve) => setTimeout(resolve, 4000)))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: false
                }))
                .then(() => call.toggleReceivingVideo()))
                .then(() => new Promise((resolve) => setTimeout(resolve, 4000)))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
            ]);
          });
        });

        describe(`when the call is started without video`, () => {
          it(`starts receiving video and stops receiving video`, () => {
            const call = spock.spark.phone.dial(mccoy.email, {
              constraints: {
                video: false
              }
            });
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => handleErrorEvent(c, () => c.answer())),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: false
                }))
                .then(() => call.toggleReceivingVideo())
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: true
                }))
                .then(() => call.toggleReceivingVideo()))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: false
                }))
            ]);
          });
        });
      });

      describe(`#toggleSendingAudio()`, () => {
        describe(`when the call is started with audio`, () => {
          it(`stops sending audio then starts sending audio`, () => {
            const call = spock.spark.phone.dial(mccoy.email);
            let mccoyCall;
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => {
                  mccoyCall = c;
                  return handleErrorEvent(c, () => c.answer());
                }),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
                .then(() => call.toggleSendingAudio())
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: false,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
                .then(() => {
                  assert.equal(mccoyCall.remote.status.audioStatus.toLowerCase(), boolToStatus(false, true));
                  assert.equal(mccoyCall.remote.status.videoStatus.toLowerCase(), boolToStatus(true, true));
                  return call.toggleSendingAudio();
                }))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
            ]);
          });
        });

        describe(`when the call is started without audio`, () => {
          // TODO [SSDK-566] Work with locus/linus to figure out why Calliope
          // blows up when adding video to an audio-only call
          it.skip(`starts sending audio and stops sending audio`, () => {
            const call = spock.spark.phone.dial(mccoy.email, {
              constraints: {
                audio: false
              }
            });
            let mccoyCall;
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => {
                  mccoyCall = c;
                  return handleErrorEvent(c, () => c.answer());
                }),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: false,
                  sendingVideo: true,
                  receivingAudio: false,
                  receivingVideo: true
                }))
                .then(() => call.toggleSendingAudio())
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: false,
                  receivingVideo: true
                }))
                .then(() => {
                  assert.equal(mccoyCall.remote.status.audioStatus.toLowerCase(), boolToStatus(true, false));
                  assert.equal(mccoyCall.remote.status.videoStatus.toLowerCase(), boolToStatus(true, true));
                  return call.toggleSendingAudio();
                }))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: false,
                  sendingVideo: true,
                  receivingAudio: false,
                  receivingVideo: true
                }))
            ]);
          });
        });
      });

      describe(`#toggleSendingVideo()`, () => {
        describe(`when the call is started with video`, () => {
          it(`stops sending video then starts sending video`, () => {
            const call = spock.spark.phone.dial(mccoy.email);
            let mccoyCall;
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => {
                  mccoyCall = c;
                  return handleErrorEvent(c, () => c.answer());
                }),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
                .then(() => call.toggleSendingVideo())
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: true
                }))
                .then(() => {
                  assert.equal(mccoyCall.remote.status.audioStatus.toLowerCase(), boolToStatus(true, true));
                  assert.equal(mccoyCall.remote.status.videoStatus.toLowerCase(), boolToStatus(false, true));
                  return call.toggleSendingVideo();
                }))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
            ]);
          });
        });

        describe(`when the call is started without video`, () => {
          // TODO [SSDK-565] Work with locus to figure out why the remote party
          // does not get notified when we add video to the call.
          it.skip(`starts sending video and stops sending video`, () => {
            const call = spock.spark.phone.dial(mccoy.email, {
              constraints: {
                video: false
              }
            });
            let mccoyCall;
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => {
                  mccoyCall = c;
                  return handleErrorEvent(c, () => c.answer());
                }),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: false
                }))
                .then(() => call.toggleSendingVideo())
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: false
                }))
                .then(() => {
                  assert.equal(mccoyCall.remote.status.audioStatus.toLowerCase(), boolToStatus(true, true));
                  assert.equal(mccoyCall.remote.status.videoStatus.toLowerCase(), boolToStatus(true, false));
                  return call.toggleSendingVideo();
                }))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: false
                }))
            ]);
          });
        });
      });

      describe(`toggle both`, () => {
        describe(`when the call starts as an audio only call`, () => {
          // TODO this test doesn't pass
          it.skip(`adds video to the call`, () => {
            const call = spock.spark.phone.dial(mccoy.email, {
              constraints: {
                video: false
              }
            });
            let mccoyCall;
            return Promise.all([
              mccoy.spark.phone.when(`call:incoming`)
                .then(([c]) => {
                  mccoyCall = c;
                  return handleErrorEvent(c, () => c.answer());
                }),
              handleErrorEvent(call, () => call.when(`connected`)
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: false
                }))
                .then(() => Promise.all([
                  call.toggleSendingAudio(),
                  call.toggleSendingVideo()
                ]))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: true,
                  receivingAudio: true,
                  receivingVideo: true
                }))
                .then(() => {
                  assert.equal(mccoyCall.remote.status.audioStatus.toLowerCase(), boolToStatus(true, true));
                  assert.equal(mccoyCall.remote.status.videoStatus.toLowerCase(), boolToStatus(true, false));
                  return Promise.all([
                    call.toggleSendingAudio(),
                    call.toggleSendingVideo()
                  ]);
                }))
                .then(() => assertLocusMediaState(call, {
                  sendingAudio: true,
                  sendingVideo: false,
                  receivingAudio: true,
                  receivingVideo: false
                }))
            ]);
          });
        });
      });
    });
  });
});

// TODO add assertions about locus send/receive values in addition to peer connection values
// TODO need test for add video to audioonly call, etc
