const Sauce = require(`../../lib/sauce`);
const wrapHandler = require(`../../lib/wrap-handler`);

module.exports = {
  command: `stop`,
  desc: `Stop a running Sauce Connect tunnel`,
  builder: {
    pid: {
      description: `pid of Sauce Connect binary. If not specified, will read from pidFile`,
      type: `number`
    }
  },
  handler: wrapHandler(async (args) => {
    await Sauce.stop(args);
  })
};