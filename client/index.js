/* global __resourceQuery */
var url = require("url");
var stripAnsi = require("strip-ansi");
var socket = require("./socket");
var overlay = require("./overlay");
//创建了一个html的iframe元素了
function getCurrentScriptSource() {
	// `document.currentScript` is the most accurate way to find the current script,
	// but is not supported in all browsers.
	// 返回脚本正在被执行的script,如websocket脚本
	if(document.currentScript)
		return document.currentScript.getAttribute("src");
	// Fall back to getting all scripts in the document.
	var scriptElements = document.scripts || [];
	var currentScript = scriptElements[scriptElements.length - 1];
	if(currentScript)
		return currentScript.getAttribute("src");
	// Fail as there was no script to use.
	throw new Error("[WDS] Failed to get current script source");
}

var urlParts;
//我们在addDevEntryPoint中有如此的配置
//const devClient = [`${require.resolve("../../client/")}?${domain}`];
//我们在打包文件中添加的是如下的形式：config.entry.app.unshift("webpack-dev-server/client?http://localhost:8080/");
//此时我们的__resourceQuery就是http://localhost:8080/
if(typeof __resourceQuery === "string" && __resourceQuery) {
	// If this bundle is inlined, use the resource query to get the correct url.
	// 如果这个打包后的文件是内联的，那么我们使用resource query来获取正确的url
	urlParts = url.parse(__resourceQuery.substr(1));
} else {
	// Else, get the url from the <script> this file was called with.
	var scriptHost = getCurrentScriptSource();
	scriptHost = scriptHost.replace(/\/[^\/]+$/, "");
	//如果是"/hello/"原样不变，如果是"/hello"那么返回""
	urlParts = url.parse((scriptHost ? scriptHost : "/"), false, true);
}

var hot = false;
var initial = true;
var currentHash = "";
//当前编译的hash
var logLevel = "info";
//默认info级别
var useWarningOverlay = false;
var useErrorOverlay = false;

// 打印log类型
function log(level, msg) {
	if(logLevel === "info" && level === "info")
		return console.log(msg);
	if(["info", "warning"].indexOf(logLevel) >= 0 && level === "warning")
		return console.warn(msg);
	if(["info", "warning", "error"].indexOf(logLevel) >= 0 && level === "error")
		return console.error(msg);
}

// Send messages to the outside, so plugins can consume it.
// 其中self用于在iframe中完成
function sendMsg(type, data) {
	if(typeof self !== "undefined" && self.window) {
		self.postMessage({
			type: "webpack" + type,
			data: data
		}, "*");
	}
}
/*
var msg = JSON.parse(e.data);
		if(handlers[msg.type])
			handlers[msg.type](msg.data);
 */
var onSocketMsg = {
	//设置hot为true
	hot: function() {
		hot = true;
		log("info", "[WDS] Hot Module Replacement enabled.");
	},
	//打印invalid
	invalid: function() {
		log("info", "[WDS] App updated. Recompiling...");
		sendMsg("Invalid");
	},
	//设置hash
	hash: function(hash) {
		currentHash = hash;
	},
	//继续可用
	"still-ok": function() {
		log("info", "[WDS] Nothing changed.")
		if(useWarningOverlay || useErrorOverlay) overlay.clear();
		sendMsg("StillOk");
	},
	//设置log级别
	"log-level": function(level) {
		logLevel = level;
	},
	/*
	Shows a full-screen overlay in the browser when there are compiler errors or warnings.
	Disabled by default. If you want to show only compiler errors:
	overlay: true
	If you want to show warnings as well as errors:
	overlay: {
	  warnings: true,
	  errors: true
	}
	 */
	"overlay": function(overlay) {
		if(typeof document !== "undefined") {
			if(typeof(overlay) === "boolean") {
				useWarningOverlay = overlay;
				useErrorOverlay = overlay;
			} else if(overlay) {
				useWarningOverlay = overlay.warnings;
				useErrorOverlay = overlay.errors;
			}
		}
	},
	//ok
	ok: function() {
		sendMsg("Ok");
		if(useWarningOverlay || useErrorOverlay) overlay.clear();
		if(initial) return initial = false;
		reloadApp();
	},
	//客户端检测到服务器端有更新,通过chokidar检测到文件的变化
	"content-changed": function() {
		log("info", "[WDS] Content base changed. Reloading...")
		self.location.reload();
	},
	warnings: function(warnings) {
		log("info", "[WDS] Warnings while compiling.");
		var strippedWarnings = warnings.map(function(warning) {
			return stripAnsi(warning);
		});
		sendMsg("Warnings", strippedWarnings);
		for(var i = 0; i < strippedWarnings.length; i++)
			console.warn(strippedWarnings[i]);
		if(useWarningOverlay) overlay.showMessage(warnings);

		if(initial) return initial = false;
		reloadApp();
	},
	errors: function(errors) {
		log("info", "[WDS] Errors while compiling. Reload prevented.");
		var strippedErrors = errors.map(function(error) {
			return stripAnsi(error);
		});
		sendMsg("Errors", strippedErrors);
		for(var i = 0; i < strippedErrors.length; i++)
			console.error(strippedErrors[i]);
		if(useErrorOverlay) overlay.showMessage(errors);
	},
	//发送消息close
	close: function() {
		log("error", "[WDS] Disconnected!");
		sendMsg("Close");
	}
};

var hostname = urlParts.hostname;
//不包含端口号
var protocol = urlParts.protocol;
//协议
//check ipv4 and ipv6 `all hostname`
if(hostname === "0.0.0.0" || hostname === "::") {
	// why do we need this check?
	// hostname n/a for file protocol (example, when using electron, ionic)
	// see: https://github.com/webpack/webpack-dev-server/pull/384
	// 如果是http协议，那么hostname为location.hostname
	if(self.location.hostname && !!~self.location.protocol.indexOf("http")) {
		hostname = self.location.hostname;
	}
}

// `hostname` can be empty when the script path is relative. In that case, specifying
// a protocol would result in an invalid URL.
// When https is used in the app, secure websockets are always necessary
// because the browser doesn't accept non-secure websockets.
// 如果服务器使用https，那么浏览器必须使用https
if(hostname && (self.location.protocol === "https:" || urlParts.hostname === "0.0.0.0")) {
	protocol = self.location.protocol;
}

//得到字符串http://example.com:8080/one?a=index&t=article&m=default
var socketUrl = url.format({
	protocol: protocol,
	auth: urlParts.auth,
	//Basic认证，这个值被计算成Authorization字段。如果request可以获取那么直接发送到服务器
	hostname: hostname,
	port: (urlParts.port === "0") ? self.location.port : urlParts.port,
	pathname: urlParts.path == null || urlParts.path === "/" ? "/sockjs-node" : urlParts.path
	//这里必须和服务器的/sockjs-node一致才能接受服务器传送的消息,服务器的prefix为'/sockjs-node'
	//因为我们一般会传入localhost:8080而不会传入path，如果要传入path那么也必须是同名的!!!!!
});

socket(socketUrl, onSocketMsg);

function reloadApp() {
	//如果开启了HMR模式
	if(hot) {
		log("info", "[WDS] App hot update...");
		var hotEmitter = require("webpack/hot/emitter");
		hotEmitter.emit("webpackHotUpdate", currentHash);
		//重新启动webpack/hot/emitter，同时设置当前hash
		if(typeof self !== "undefined" && self.window) {
			// broadcast update to window
			self.postMessage("webpackHotUpdate" + currentHash, "*");
		}
	} else {
	   //如果不是Hotupdate那么我们直接reload我们的window就可以了
		log("info", "[WDS] App updated. Reloading...");
		self.location.reload();
	}
}
