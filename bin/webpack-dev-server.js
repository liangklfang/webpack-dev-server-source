#!/usr/bin/env node
"use strict";

const path = require("path");
const open = require("opn");
const fs = require("fs");
const net = require("net");
const portfinder = require("portfinder");
const addDevServerEntrypoints = require("../lib/util/addDevServerEntrypoints");
const createDomain = require("../lib/util/createDomain");

// Local version replaces global one
// 本地的版本优先级比全局的要高，__filename和__dirname不同在于后者表示目录，而前者表示该文件的完整文件名(包括路径)
try {
	const localWebpackDevServer = require.resolve(path.join(process.cwd(), "node_modules", "webpack-dev-server", "bin", "webpack-dev-server.js"));
	if(__filename !== localWebpackDevServer) {
		return require(localWebpackDevServer);
	}
} catch(e) {}

const Server = require("../lib/Server");
//获取Server.js
const webpack = require("webpack");
//获取webpack
function versionInfo() {
	return `webpack-dev-server ${require("../package.json").version}\n` +
		`webpack ${require("webpack/package.json").version}`;
}
//返回webpack-dev-server的版本和webpack本身的版本

function colorInfo(useColor, msg) {
	if(useColor)
		// Make text blue and bold, so it *pops*
		return `\u001b[1m\u001b[34m${msg}\u001b[39m\u001b[22m`;
	return msg;
}

function colorError(useColor, msg) {
	if(useColor)
		// Make text red and bold, so it *pops*
		return `\u001b[1m\u001b[31m${msg}\u001b[39m\u001b[22m`;
	return msg;
}

const yargs = require("yargs")
	.usage(`${versionInfo()
		}\nUsage: https://webpack.js.org/configuration/dev-server/`);

require("webpack/bin/config-yargs")(yargs);

// It is important that this is done after the webpack yargs config,
// so it overrides webpack's version info.
yargs.version(versionInfo);

const ADVANCED_GROUP = "Advanced options:";
const DISPLAY_GROUP = "Stats options:";
const SSL_GROUP = "SSL options:";
const CONNECTION_GROUP = "Connection options:";
const RESPONSE_GROUP = "Response options:";
const BASIC_GROUP = "Basic options:";

// Taken out of yargs because we must know if
// it wasn't given by the user, in which case
// we should use portfinder.
const DEFAULT_PORT = 8080;

//为yargs添加option选项
yargs.options({
	//filename必须和lazy同时使用才会有效
	//This option lets you reduce the compilations in lazy mode. By default in lazy mode, 
	//every request results in a new compilation. With filename, it's possible to only compile
	// when a certain file is requested.
	"lazy": {
		type: "boolean",
		describe: "Lazy"
	},
	"inline": {
		type: "boolean",
		default: true,
		describe: "Inline mode (set to false to disable including client scripts like livereload)"
	},
	"progress": {
		type: "boolean",
		describe: "Print compilation progress in percentage",
		group: BASIC_GROUP
	},
	//hot||hotOnly启动HMR
	"hot-only": {
		type: "boolean",
		describe: "Do not refresh page if HMR fails",
		group: ADVANCED_GROUP
	},
	"stdin": {
		type: "boolean",
		describe: "close when stdin ends"
	},
	"open": {
		type: "boolean",
		describe: "Open default browser"
	},
	"color": {
		type: "boolean",
		alias: "colors",
		default: function supportsColor() {
			return require("supports-color");
		},
		group: DISPLAY_GROUP,
		describe: "Enables/Disables colors on the console"
	},
	"info": {
		type: "boolean",
		group: DISPLAY_GROUP,
		default: true,
		describe: "Info"
	},
	"quiet": {
		type: "boolean",
		group: DISPLAY_GROUP,
		describe: "Quiet"
	},
	// 客户端log级别,clientLogLevel: "none"那么就相当于关闭了log
	"client-log-level": {
		type: "string",
		group: DISPLAY_GROUP,
		default: "info",
		describe: "Log level in the browser (info, warning, error or none)"
	},
	"https": {
		type: "boolean",
		group: SSL_GROUP,
		describe: "HTTPS"
	},
	"key": {
		type: "string",
		describe: "Path to a SSL key.",
		group: SSL_GROUP
	},
	"cert": {
		type: "string",
		describe: "Path to a SSL certificate.",
		group: SSL_GROUP
	},
	"cacert": {
		type: "string",
		describe: "Path to a SSL CA certificate.",
		group: SSL_GROUP
	},
	"pfx": {
		type: "string",
		describe: "Path to a SSL pfx file.",
		group: SSL_GROUP
	},
	"pfx-passphrase": {
		type: "string",
		describe: "Passphrase for pfx file.",
		group: SSL_GROUP
	},
	//当命令行中输入的时候有用，在webpack.config.js中配置无用。当请求静态资源的时候有用
	//Can be used to configure the behaviour of webpack-dev-server when the webpack config is passed to webpack-dev-server CLI.
	"content-base": {
		type: "string",
		describe: "A directory or URL to serve HTML content from.",
		group: RESPONSE_GROUP
	},
	"watch-content-base": {
		type: "boolean",
		describe: "Enable live-reloading of the content-base.",
		group: RESPONSE_GROUP
	},
	"history-api-fallback": {
		type: "boolean",
		describe: "Fallback to /index.html for Single Page Applications.",
		group: RESPONSE_GROUP
	},
	//Gzip压缩 ,Enable gzip compression for everything served:
	"compress": {
		type: "boolean",
		describe: "Enable gzip compression",
		group: RESPONSE_GROUP
	},
	"port": {
		describe: "The port",
		group: CONNECTION_GROUP
	},
	//监听的socket
	"socket": {
		type: "String",
		describe: "Socket to listen",
		group: CONNECTION_GROUP
	},
	"public": {
		type: "string",
		describe: "The public hostname/ip address of the server",
		group: CONNECTION_GROUP
	},
	"host": {
		type: "string",
		default: "localhost",
		describe: "The hostname/ip address the server will bind to",
		group: CONNECTION_GROUP
	}
});

const argv = yargs.argv;
//获取参数
const wpOpt = require("webpack/bin/convert-argv")(yargs, argv, {
	outputFilename: "/bundle.js"
});
//输出文件名称

function processOptions(wpOpt) {
	// process Promise
	// 如果是promise那么直接调用then方法
	if(typeof wpOpt.then === "function") {
		wpOpt.then(processOptions).catch(function(err) {
			console.error(err.stack || err);
			process.exit(); // eslint-disable-line
		});
		return;
	}

	const firstWpOpt = Array.isArray(wpOpt) ? wpOpt[0] : wpOpt;
	//获取参数
	const options = wpOpt.devServer || firstWpOpt.devServer || {};
	//devServer配置

	if(argv.host !== "localhost" || !options.host)
		options.host = argv.host;
	//更新host到devServer配置

	if(argv.public)
		options.public = argv.public;
	//更新public到devServer配置

	if(argv.socket)
		options.socket = argv.socket;
	//更新socket到devServer配置

	if(!options.publicPath) {
		options.publicPath = firstWpOpt.output && firstWpOpt.output.publicPath || "";
		if(!/^(https?:)?\/\//.test(options.publicPath) && options.publicPath[0] !== "/")
			options.publicPath = `/${options.publicPath}`;
	}
	//如果devServer没有配置publicPath，那么其值就是output.publicPath，默认是""
	//如果第一个字符不是"/"那么就添加"/"

	if(!options.filename)
		options.filename = firstWpOpt.output && firstWpOpt.output.filename;
    //更新output.filename到devServer配置filename

	if(!options.watchOptions)
		options.watchOptions = firstWpOpt.watchOptions;
	//更新watchOptions到devServer

	if(argv["stdin"]) {
		process.stdin.on("end", function() {
			process.exit(0); // eslint-disable-line no-process-exit
		});
		process.stdin.resume();
	}
    
	if(!options.hot)
		options.hot = argv["hot"];
	//更新hot到devServer

	if(!options.hotOnly)
		options.hotOnly = argv["hot-only"];
	//更新hotOnly到devServer

	if(!options.clientLogLevel)
		options.clientLogLevel = argv["client-log-level"];
	//更新client-log-level到devServer

	if(options.contentBase === undefined) {
		if(argv["content-base"]) {
			options.contentBase = argv["content-base"];
			if(/^[0-9]$/.test(options.contentBase))
				options.contentBase = +options.contentBase;
			//转化为数字
			else if(!/^(https?:)?\/\//.test(options.contentBase))
				options.contentBase = path.resolve(options.contentBase);
		//如果不是http或者https那么我们应该使用path.resolve来查找
		// It is possible to disable the contentBase by using `--no-content-base`, which results in arg["content-base"] = false
		} else if(argv["content-base"] === false) {
			options.contentBase = false;
		}
	}
	//更新contentBase到devServer

	if(argv["watch-content-base"])
		options.watchContentBase = true;
    //更新watch-contentBase到devServer
    
	if(!options.stats) {
		options.stats = {
			cached: false,
			cachedAssets: false
		};
	}
	//更新stats到devServer

	if(typeof options.stats === "object" && typeof options.stats.colors === "undefined")
		options.stats.colors = argv.color;
    //更新color到devServer
	if(argv["lazy"])
		options.lazy = true;
    //更新lazy到devServer
	if(!argv["info"])
		options.noInfo = true;
    //更新info到devServer
	if(argv["quiet"])
		options.quiet = true;
    //更新quite到devServer
	if(argv["https"])
		options.https = true;
    //更新https到devServer
	if(argv["cert"])
		options.cert = fs.readFileSync(path.resolve(argv["cert"]));

	if(argv["key"])
		options.key = fs.readFileSync(path.resolve(argv["key"]));

	if(argv["cacert"])
		options.ca = fs.readFileSync(path.resolve(argv["cacert"]));

	if(argv["pfx"])
		options.pfx = fs.readFileSync(path.resolve(argv["pfx"]));

	if(argv["pfx-passphrase"])
		options.pfxPassphrase = argv["pfx-passphrase"];

	if(argv["inline"] === false)
		options.inline = false;

	if(argv["history-api-fallback"])
		options.historyApiFallback = true;

	if(argv["compress"])
		options.compress = true;

	if(argv["open"])
		options.open = true;

	// Kind of weird, but ensures prior behavior isn't broken in cases
	// that wouldn't throw errors. E.g. both argv.port and options.port
	// were specified, but since argv.port is 8080, options.port will be
	// tried first instead.
	options.port = argv.port === DEFAULT_PORT ? (options.port || argv.port) : (argv.port || options.port);
	//端口号默认是8080，如果shell命令行传入了port同时devServer中也有port那么使用devServer的port,也就是shell
	//控制台优先级更低
	if(options.port) {
		startDevServer(wpOpt, options);
		return;
	}
    //如果用户设置了一个port为""
    //https://github.com/liangklfang/node-portfinder
    //A simple tool to find an open port or domain socket on the current machine
	portfinder.basePort = DEFAULT_PORT;
	portfinder.getPort(function(err, port) {
		if(err) throw err;
		options.port = port;
		startDevServer(wpOpt, options);
	});
}

//其中options是要传递给devServer的，而wpOpt是所有的yarg接受到的参数
function startDevServer(wpOpt, options) {
	addDevServerEntrypoints(wpOpt, options);
	//为我们的webpack.config.js的entry中添加client端代码，和hot代码并开始编译
	let compiler;
	try {
		compiler = webpack(wpOpt);
		//开始webpack编译
	} catch(e) {
		if(e instanceof webpack.WebpackOptionsValidationError) {
			console.error(colorError(options.stats.colors, e.message));
			process.exit(1); // eslint-disable-line
		}
		throw e;
	}
    //添加ProgressPlugin进度插件,表明打包已经百分之多少了
	if(argv["progress"]) {
		compiler.apply(new webpack.ProgressPlugin({
			profile: argv["profile"]
		}));
	}
    //把devServer创建一个新的domain,如果不是inline模式那么需要在url中添加/webpack-dev-server/
	const uri = createDomain(options) + (options.inline !== false || options.lazy === true ? "/" : "/webpack-dev-server/");
	let server;
	try {
		server = new Server(compiler, options);
		//webpack编译已经开始，此时创建服务端
	} catch(e) {
		const OptionsValidationError = require("../lib/OptionsValidationError");
		if(e instanceof OptionsValidationError) {
			console.error(colorError(options.stats.colors, e.message));
			process.exit(1); // eslint-disable-line
		}
		throw e;
	}
    //用户在devServer中传入了socket
	if(options.socket) {
		//this.listeningApp一样
		server.listeningApp.on("error", function(e) {
			if(e.code === "EADDRINUSE") {
				//如果报错说服务器端口占用
				const clientSocket = new net.Socket();
				clientSocket.on("error", function(e) {
					if(e.code === "ECONNREFUSED") {
						// No other server listening on this socket so it can be safely removed
						fs.unlinkSync(options.socket);
						server.listen(options.socket, options.host, function(err) {
							if(err) throw err;
						});
					}
				});
				clientSocket.connect({ path: options.socket }, function() {
					throw new Error("This socket is already used");
				});
			}
		});
		//server调用listen方法，其中socket/host传入我们的自己的socket
		//unix domain socket,http://stackoverflow.com/questions/33398936/can-webpack-dev-server-run-on-a-unix-domain-sockets
		server.listen(options.socket, options.host, function(err) {
			if(err) throw err;
			const READ_WRITE = 438; // chmod 666 (rw rw rw)
			//看来我们传入的socket是一个文件
			fs.chmod(options.socket, READ_WRITE, function(err) {
				if(err) throw err;
				reportReadiness(uri, options);
			});
		});
	} else {
		//server.listen([port][, hostname][, backlog][, callback])
		server.listen(options.port, options.host, function(err) {
			if(err) throw err;
			reportReadiness(uri, options);
		});
	}
}

//uri为如下:
//const uri = createDomain(options) + (options.inline !== false || options.lazy === true ? "/" : "/webpack-dev-server/");

function reportReadiness(uri, options) {
	const useColor = argv.color;
	//是否使用颜色
	let startSentence = `Project is running at ${colorInfo(useColor, uri)}`
	if(options.socket) {
		startSentence = `Listening to socket at ${colorInfo(useColor, options.socket)}`;
	}
	console.log((argv["progress"] ? "\n" : "") + startSentence);
	//是否有进度信息
	console.log(`webpack output is served from ${colorInfo(useColor, options.publicPath)}`);
	const contentBase = Array.isArray(options.contentBase) ? options.contentBase.join(", ") : options.contentBase;
	//设置contentBase
	if(contentBase)
		console.log(`Content not from webpack is served from ${colorInfo(useColor, contentBase)}`);
	//更加说明了contentBase不是从webpack打包中获取的，而是直接express.static指定静态文件路径
	if(options.historyApiFallback)
		console.log(`404s will fallback to ${colorInfo(useColor, options.historyApiFallback.index || "/index.html")}`);
	//historyApiFallback回退到index.html
	if(options.open) {
		//打开一个页面
		open(uri).catch(function() {
			console.log("Unable to open browser. If you are running in a headless environment, please do not use the open flag.");
		});
	}
}

processOptions(wpOpt);
