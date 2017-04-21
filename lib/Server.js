"use strict";

const fs = require("fs");
const chokidar = require("chokidar");
//监听文件变化
const path = require("path");
const webpackDevMiddleware = require("webpack-dev-middleware");
//"webpack-dev-middleware"中间件
const express = require("express");
//express服务器
const compress = require("compression");
const sockjs = require("sockjs");
//socket家族,用于服务端node-socket
const http = require("http");
const spdy = require("spdy");
//http/2 (h2) and spdy (2,3,3.1) supported
const httpProxyMiddleware = require("http-proxy-middleware");
const serveIndex = require("serve-index");
//Serves pages that contain directory listings for a given path.
const historyApiFallback = require("connect-history-api-fallback");
const webpack = require("webpack");
const OptionsValidationError = require("./OptionsValidationError");
const optionsSchema = require("./optionsSchema.json");
const clientStats = { errorDetails: false };

function Server(compiler, options) {
	// Default options
	if(!options) options = {};

	const validationErrors = webpack.validateSchema(optionsSchema, options);
	//是否符合一个特定的Schema,来自于webpack的方法
	if(validationErrors.length) {
		throw new OptionsValidationError(validationErrors);
	}
    //lazy模式下必须设置文件名
	if(options.lazy && !options.filename) {
		throw new Error("'filename' option must be set in lazy mode.");
	}
	this.hot = options.hot || options.hotOnly;
	//是否启动HMR
	this.headers = options.headers;
	//要添加到res中的header对象
	this.clientLogLevel = options.clientLogLevel;
	//客户端打印log的级别，warn/error。 controls the console log messages shown in the browser
	this.clientOverlay = options.overlay;
	//Shows a full-screen overlay in the browser when there are compiler errors or warnings.
	// Disabled by default. If you want to show only compiler errors:
	this.sockets = [];
	//socket中放的都是我们的socketjs的connection对象
	this.contentBaseWatchers = [];
	//chokidar.watch用于监听文件比那话返回的watcher对象
	// Listening for events
	const invalidPlugin = function() {
		this.sockWrite(this.sockets, "invalid");
	}.bind(this);
	compiler.plugin("compile", invalidPlugin);
	compiler.plugin("invalid", invalidPlugin);
	compiler.plugin("done", function(stats) {
		this._sendStats(this.sockets, stats.toJson(clientStats));
		this._stats = stats;
	}.bind(this));
    //成功"done"后，我们用_stats保存stats
	// Init express server
	const app = this.app = new express();
	// middleware for serving webpack bundle
	this.middleware = webpackDevMiddleware(compiler, options);
	//保存webpack-dev-middleware实例
	app.get("/__webpack_dev_server__/live.bundle.js", function(req, res) {
		res.setHeader("Content-Type", "application/javascript");
		fs.createReadStream(path.join(__dirname, "..", "client", "live.bundle.js")).pipe(res);
	});
	//把我们读取的文件live.bundle.js原样发送给我们的response对象，因为他也是我们的Stream对象

	app.get("/__webpack_dev_server__/sockjs.bundle.js", function(req, res) {
		res.setHeader("Content-Type", "application/javascript");
		fs.createReadStream(path.join(__dirname, "..", "client", "sockjs.bundle.js")).pipe(res);
	});
	//sockjs.bundle.js发送

	app.get("/webpack-dev-server.js", function(req, res) {
		res.setHeader("Content-Type", "application/javascript");
		fs.createReadStream(path.join(__dirname, "..", "client", "index.bundle.js")).pipe(res);
	});
	//index.bundle.js文件原样发送
	app.get("/webpack-dev-server/*", function(req, res) {
		res.setHeader("Content-Type", "text/html");
		fs.createReadStream(path.join(__dirname, "..", "client", "live.html")).pipe(res);
	});
	//发送html，每一个元素都是一个超链接，点击转到具体的文件
	app.get("/webpack-dev-server", function(req, res) {
		res.setHeader("Content-Type", "text/html");
		/* eslint-disable quotes */
		res.write('<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>');
		const path = this.middleware.getFilenameFromUrl(options.publicPath || "/");
		//得到路径
		const fs = this.middleware.fileSystem;
        //获取fileSystem对象，其中baseUrl是我们的publicPath,basePath
		function writeDirectory(baseUrl, basePath) {
			const content = fs.readdirSync(basePath);
			//得到文件系统下所有的文件
			res.write("<ul>");
			content.forEach(function(item) {
				const p = `${basePath}/${item}`;
				if(fs.statSync(p).isFile()) {
					res.write('<li><a href="');
					res.write(baseUrl + item);
					res.write('">');
					res.write(item);
					res.write('</a></li>');
					if(/\.js$/.test(item)) {
						const htmlItem = item.substr(0, item.length - 3);
						res.write('<li><a href="');
						res.write(baseUrl + htmlItem);
						res.write('">');
						res.write(htmlItem);
						res.write('</a> (magic html for ');
						res.write(item);
						res.write(') (<a href="');
						res.write(baseUrl.replace(/(^(https?:\/\/[^\/]+)?\/)/, "$1webpack-dev-server/") + htmlItem);
						res.write('">webpack-dev-server</a>)</li>');
					}
				} else {
					res.write('<li>');
					res.write(item);
					res.write('<br>');
					writeDirectory(`${baseUrl + item}/`, p);
					res.write('</li>');
				}
			});
			res.write("</ul>");
		}
		writeDirectory(options.publicPath || "/", path);
		res.end("</body></html>");
	}.bind(this));
	let contentBase;
	if(options.contentBase !== undefined) {
		contentBase = options.contentBase;
	} else {
		contentBase = process.cwd();
	}
    //contentBase默认就是process.cwd()
	const features = {
		compress: function() {
			if(options.compress) {
				// Enable gzip compression.
				// 启动gzip
				app.use(compress());
			}
		},

		proxy: function() {
			//启动代理
			if(options.proxy) {
				/**
				 * Assume a proxy configuration specified as:
				 * proxy: {
				 *   'context': { options }
				 * }
				 * OR
				 * proxy: {
				 *   'context': 'target'
				 * }
				 * 例子
				 * proxy: {
					    "**": "http://localhost:9090"
					  },
				 */
				if(!Array.isArray(options.proxy)) {
					options.proxy = Object.keys(options.proxy).map(function(context) {
						//context是key
						let proxyOptions;
						// For backwards compatibility reasons.
						const correctedContext = context.replace(/^\*$/, "**").replace(/\/\*$/, "");
						if(typeof options.proxy[context] === "string") {
							proxyOptions = {
								context: correctedContext,
								//context就是proxy的第一个参数，也就是path路径，也就是被带来的path
								target: options.proxy[context]
								//代理到的目标host
							};
						} else {
							proxyOptions = options.proxy[context];
							proxyOptions.context = correctedContext;
							//如果options.proxy[context]不是string，那么必定是一个object类型
							//这时候我们的context就是key
						}
						proxyOptions.logLevel = proxyOptions.logLevel || "warn";
                        //log
						return proxyOptions;
					});
				}

				const getProxyMiddleware = function(proxyConfig) {
					const context = proxyConfig.context || proxyConfig.path;
					 //context或者path表示要代理的API路径
					// It is possible to use the `bypass` method without a `target`.
					// However, the proxy middleware has no use in this case, and will fail to instantiate.
					// 如果有target表示要代理到这个host
					if(proxyConfig.target) {
						return httpProxyMiddleware(context, proxyConfig);
					}
					//获取httpProxyMiddleware方法，传入context和proxyConfig
				}

				/**
				 * Assume a proxy configuration specified as:
				 * proxy: [
				 *   {
				 *     context: ...,
				 *     ...options...
				 *   },
				 *   // or:
				 *   function() {
				 *     return {
				 *       context: ...,
				 *       ...options...
				 *     };
				 *	 }
				 * ]
				 *
				 * //或者如下面的例子
				 * proxy: {
				  "/api": {
				    target: "http://localhost:3000",
				    bypass: function(req, res, proxyOptions) {
				      if (req.headers.accept.indexOf("html") !== -1) {
				        console.log("Skipping proxy for browser request.");
				        return "/index.html";
				      }
				    }
				  }
				}
				得到如下:
			    [{
			      bypass: (req, res, proxyOptions){},
			      context: "/api",
			      logLevel: "warn",
			      target: "http://localhost:3000"
			      }]
				 */
				//已经被上面处理过了
				options.proxy.forEach(function(proxyConfigOrCallback) {
					let proxyConfig;
					let proxyMiddleware;

					if(typeof proxyConfigOrCallback === "function") {
						proxyConfig = proxyConfigOrCallback();
						//如果是函数直接回调该函数，因为callback回调一般都是在最后回调的
					} else {
						//如果不是函数那么直接保存
						proxyConfig = proxyConfigOrCallback;
					}
					proxyMiddleware = getProxyMiddleware(proxyConfig);
					//这里仅仅是返回一个proxy实例,可以直接传入到app.use中作为参数
	                /*
	                var app = express();
				    app.use('/api', exampleProxy);
				    app.listen(3000);
	                 */
	                //下面传入app.use的是一个函数，那么会调用这个函数获取到一个中间件
					app.use(function(req, res, next) {
						if(typeof proxyConfigOrCallback === "function") {
							const newProxyConfig = proxyConfigOrCallback();
							if(newProxyConfig !== proxyConfig) {
								proxyConfig = newProxyConfig;
								proxyMiddleware = getProxyMiddleware(proxyConfig);
							}
							//继续调用，如果调用我们的函数后proxy配置发生变化了，那么我们会继续调用getProxyMiddleware
							//该方法会更新上面我们得到的proxyMiddleware。把更新后的proxyConfig继续传入获取更新后的middleware
						}
						const bypass = typeof proxyConfig.bypass === "function";
						const bypassUrl = bypass && proxyConfig.bypass(req, res, proxyConfig) || false;
                        //把bypassUrl作为req.url并继续调用下一个中间件
						if(bypassUrl) {
							req.url = bypassUrl;
							next();
						} else if(proxyMiddleware) {
							return proxyMiddleware(req, res, next);
						} else {
							next();
						}
					});
				});
			}
		},

		historyApiFallback: function() {
			if(options.historyApiFallback) {
				// Fall back to /index.html if nothing else matches.
				// 对于一些请求我们使用index.html作为资源返回
				app.use(
					historyApiFallback(typeof options.historyApiFallback === "object" ? options.historyApiFallback : null)
				);
			}
		},
        
        //将contentBase作为express.static的参数传入，这时候我们直接访问这个路径下的资源就可以了
        //同时也不需要添加contentBase到路径中
		contentBaseFiles: function() {
			//如果contentBase是数组
			if(Array.isArray(contentBase)) {
				contentBase.forEach(function(item) {
					app.get("*", express.static(item));
				});
			 //如果contentBase是https/http的路径，那么重定向
			} else if(/^(https?:)?\/\//.test(contentBase)) {
				console.log("Using a URL as contentBase is deprecated and will be removed in the next major version. Please use the proxy option instead.");
				console.log('proxy: {\n\t"*": "<your current contentBase configuration>"\n}'); // eslint-disable-line quotes
				// Redirect every request to contentBase
				app.get("*", function(req, res) {
					res.writeHead(302, {
						"Location": contentBase + req.path + (req._parsedUrl.search || "")
					});
					res.end();
				});
			} else if(typeof contentBase === "number") {
				console.log("Using a number as contentBase is deprecated and will be removed in the next major version. Please use the proxy option instead.");
				console.log('proxy: {\n\t"*": "//localhost:<your current contentBase configuration>"\n}'); // eslint-disable-line quotes
				// Redirect every request to the port contentBase
				app.get("*", function(req, res) {
					res.writeHead(302, {
						"Location": `//localhost:${contentBase}${req.path}${req._parsedUrl.search || ""}`
					});
					res.end();
				});
			} else {
				// route content request
				// http://www.expressjs.com.cn/starter/static-files.html
				// 把静态文件的目录传递给static那么以后就可以直接访问了
				app.get("*", express.static(contentBase, options.staticOptions));
			}
		},
        //serveIndex
		contentBaseIndex: function() {
			if(Array.isArray(contentBase)) {
				contentBase.forEach(function(item) {
					app.get("*", serveIndex(item));
				});
			} else if(!/^(https?:)?\/\//.test(contentBase) && typeof contentBase !== "number") {
				app.get("*", serveIndex(contentBase));
			}
		},
        
		watchContentBase: function() {
			//如果contentBase有http或者https开头，或者contentBase为number类型那么抛出错误
			if(/^(https?:)?\/\//.test(contentBase) || typeof contentBase === "number") {
				throw new Error("Watching remote files is not supported.");
			} else if(Array.isArray(contentBase)) {
				//如果contentBase是一个数组，那么监听这个数组的所有文件
				contentBase.forEach(function(item) {
					this._watch(item);
				}.bind(this));
			} else {
				//否则仅仅监听一个文件
				this._watch(contentBase);
			}
		}.bind(this),

		middleware: function() {
			// include our middleware to ensure it is able to handle '/index.html' request after redirect
			// 能够处理index.html文件
			app.use(this.middleware);
		}.bind(this),
       //设置this.headers到res中
		headers: function() {
			app.all("*", this.setContentHeaders.bind(this));
		}.bind(this),
        //使用html执行js
		magicHtml: function() {
			app.get("*", this.serveMagicHtml.bind(this));
		}.bind(this),

		setup: function() {
			if(typeof options.setup === "function")
				options.setup(app, this);
		}.bind(this)
	};

    //默认包含哪些功能
	const defaultFeatures = ["setup", "headers", "middleware"];
	if(options.proxy)
		defaultFeatures.push("proxy", "middleware");
	if(contentBase !== false)
		defaultFeatures.push("contentBaseFiles");
	if(options.watchContentBase)
		defaultFeatures.push("watchContentBase");
	if(options.historyApiFallback) {
		defaultFeatures.push("historyApiFallback", "middleware");
		if(contentBase !== false)
			defaultFeatures.push("contentBaseFiles");
	}
	defaultFeatures.push("magicHtml");
	if(contentBase !== false)
		defaultFeatures.push("contentBaseIndex");
	// compress is placed last and uses unshift so that it will be the first middleware used
	// compress作为第一个中间件
	if(options.compress)
		defaultFeatures.unshift("compress");
    //用户自己定义的features集合或者使用defaultFeatures集合
	(options.features || defaultFeatures).forEach(function(feature) {
		features[feature]();
	}, this);

    //是否支持https
	if(options.https) {
		// for keep supporting CLI parameters
		if(typeof options.https === "boolean") {
			options.https = {
				key: options.key,//key私钥
				cert: options.cert,//cert证书
				ca: options.ca,//ca数字证书认证中心
				pfx: options.pfx,//pfx公钥加密技术12号标准
				passphrase: options.pfxPassphrase//pfxPassphrase密码
			};
		}

		// Use built-in self-signed certificate if no certificate was configured
		// 提供证书
		const fakeCert = fs.readFileSync(path.join(__dirname, "../ssl/server.pem"));
		options.https.key = options.https.key || fakeCert;
		//私钥
		options.https.cert = options.https.cert || fakeCert;
		//证书，如果没有指定spdy那么我们使用http2和http/1.1
		if(!options.https.spdy) {
			options.https.spdy = {
				protocols: ["h2", "http/1.1"]
			};
		}
     	this.listeningApp = spdy.createServer(options.https, app);
     	//如果说要采用https，那么我们使用spdy创建server
	} else {
		this.listeningApp = http.createServer(app);
	}
}

Server.prototype.use = function() {
	this.app.use.apply(this.app, arguments);
}

//把this.headers中的http头设置到res中
Server.prototype.setContentHeaders = function(req, res, next) {
	if(this.headers) {
		for(const name in this.headers) {
			res.setHeader(name, this.headers[name]);
		}
	}
	next();
}

// delegate listen call and init sockjs
Server.prototype.listen = function() {
	const returnValue = this.listeningApp.listen.apply(this.listeningApp, arguments);
	const sockServer = sockjs.createServer({
		// Use provided up-to-date sockjs-client
		sockjs_url: "/__webpack_dev_server__/sockjs.bundle.js",
		// Limit useless logs
		log: function(severity, line) {
			if(severity === "error") {
				console.log(line);
			}
		}
	});
	//我们服务器端接受到connection时候触发
	sockServer.on("connection", function(conn) {
		if(!conn) return;
		this.sockets.push(conn);
        //我们this.sockets中放的是connection
		conn.on("close", function() {
			const connIndex = this.sockets.indexOf(conn);
			if(connIndex >= 0) {
				this.sockets.splice(connIndex, 1);
			}
		}.bind(this));
		//客户端断开那么从this.sockets中移除
		if(this.clientLogLevel)
			this.sockWrite([conn], "log-level", this.clientLogLevel);
         //this.clientLogLevel:Log level in the browser (info, warning, error or none)
		if(this.clientOverlay)
			this.sockWrite([conn], "overlay", this.clientOverlay);

		if(this.hot) this.sockWrite([conn], "hot");
         //向所有的客户端写入hot模式
		if(!this._stats) return;
		this._sendStats([conn], this._stats.toJson(clientStats), true);
	}.bind(this));
    
    //this.listeningApp是我们的服务器
	sockServer.installHandlers(this.listeningApp, {
		prefix: "/sockjs-node"
	});
	return returnValue;
}

/*
(1)所有的socket放弃监听，调用connection.close方法
(2)关闭spdy服务器，关闭后回调停止让webpack监听文件变化。调用webpack的compiler.watch方法返回的Watching对象的close方法完成
(3)contentBase下的文件不需要监听了，重置this.contentBaseWatchers = [];
 */
Server.prototype.close = function(callback) {
	this.sockets.forEach(function(sock) {
		sock.close();
	});
	this.sockets = [];
	this.listeningApp.close(function() {
		this.middleware.close(callback);
	}.bind(this));

	this.contentBaseWatchers.forEach(function(watcher) {
		watcher.close();
	});
	this.contentBaseWatchers = [];
}

//调用方式this.sockWrite(this.sockets, "invalid"),其中data可以保存本次编译的hash
//socketjs-node为调用每一个connection.write方法
//this.sockWrite([conn], "log-level", this.clientLogLevel);表示关闭这个socket，提供type为"log-level"，data中保存的是"warn/error"等字符串
/*
客户端是如此处理的:
if(handlers[msg.type])
			handlers[msg.type](msg.data);
而handlers会有这个"log-level"方法:
"log-level": function(level) {
		logLevel = level;
	}
 */
Server.prototype.sockWrite = function(sockets, type, data) {
	sockets.forEach(function(sock) {
		sock.write(JSON.stringify({
			type: type,
			data: data
		}));
	});
}

Server.prototype.serveMagicHtml = function(req, res, next) {
	const _path = req.path;
	//获取路径
	try {
		if(!this.middleware.fileSystem.statSync(this.middleware.getFilenameFromUrl(`${_path}.js`)).isFile())
			return next();
		// Serve a page that executes the javascript
		/* eslint-disable quotes */
		res.write('<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><script type="text/javascript" charset="utf-8" src="');
		res.write(_path);
		res.write('.js');
		res.write(req._parsedUrl.search || "");
		res.end('"></script></body></html>');
		/* eslint-enable quotes */
	} catch(e) {
		return next();
	}
}

// send stats to a socket or multiple sockets
// this._sendStats(this.sockets, stats.toJson(clientStats));
Server.prototype._sendStats = function(sockets, stats, force) {
	if(!force &&
		stats &&
		(!stats.errors || stats.errors.length === 0) &&
		stats.assets &&
		stats.assets.every(function(asset) {
			return !asset.emitted;
			//每一个asset都是没有emitted属性，表示没有发生变化。如果发生变化那么这个assets肯定有emitted属性
		})
	)
		return this.sockWrite(sockets, "still-ok");
	this.sockWrite(sockets, "hash", stats.hash);
	//设置hash
	if(stats.errors.length > 0)
		this.sockWrite(sockets, "errors", stats.errors);
	else if(stats.warnings.length > 0)
		this.sockWrite(sockets, "warnings", stats.warnings);
	else
		this.sockWrite(sockets, "ok");
}

//监听一个路径,同时在this.contentBaseWatchers中push进入我们当前这个watcher
Server.prototype._watch = function(path) {
	const watcher = chokidar.watch(path).on("change", function() {
		this.sockWrite(this.sockets, "content-changed");
	}.bind(this))
	//通知client端文件变化，每次文件变化都会返回一个watcher对象
	this.contentBaseWatchers.push(watcher);
}

//调用Watching对象的invalidate方法
Server.prototype.invalidate = function() {
	if(this.middleware) this.middleware.invalidate();
}

// Export this logic, so that other implementations, like task-runners can use it
Server.addDevServerEntrypoints = require("./util/addDevServerEntrypoints");

module.exports = Server;
