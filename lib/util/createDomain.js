"use strict";
const url = require("url");
//调用const domain = createDomain(devServerOptions);
module.exports = function createDomain(options) {
	const protocol = options.https ? "https" : "http";
	// the formatted domain (url without path) of the webpack server
	// 返回protocol+options.public
	return options.public ? `${protocol}://${options.public}` : url.format({
		protocol: protocol,
		hostname: options.host,
		//如果没有配置那么通过host
		port: options.socket ? 0 : options.port.toString()
		//如果传入了socket那么port为0，否则为devServer配置的port
	});
};
