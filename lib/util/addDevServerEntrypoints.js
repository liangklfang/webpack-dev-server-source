"use strict";
const createDomain = require("./createDomain");

//其中devServerOptions是要传递给devServer的，而webpackOptions是所有的yarg接受到的参数，包含了webpack中配置的devServer选项
module.exports = function addDevServerEntrypoints(webpackOptions, devServerOptions) {
	if(devServerOptions.inline !== false) {
		//表示是inline模式而不是iframe模式
		const domain = createDomain(devServerOptions);
		const devClient = [`${require.resolve("../../client/")}?${domain}`];
		//客户端内容
		if(devServerOptions.hotOnly)
			devClient.push("webpack/hot/only-dev-server");
		else if(devServerOptions.hot)
			devClient.push("webpack/hot/dev-server");
	    //配置了不同的webpack而文件到客户端文件中
		[].concat(webpackOptions).forEach(function(wpOpt) {
			if(typeof wpOpt.entry === "object" && !Array.isArray(wpOpt.entry)) {
				/*
				  entry:{
	                index:'./index.js',
	                index1:'./index1.js'
				  }
				 */
				Object.keys(wpOpt.entry).forEach(function(key) {
					wpOpt.entry[key] = devClient.concat(wpOpt.entry[key]);
				});
				//添加我们自己的入口文件
			} else if(typeof wpOpt.entry === "function") {
				wpOpt.entry = wpOpt.entry(devClient);
				//如果entry是一个函数那么我们把devClient数组传入
			} else {
				wpOpt.entry = devClient.concat(wpOpt.entry);
				//数组直接传入
			}
		});
	}
};
