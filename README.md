###学会使用webpack的方法来判断schema是否符合条件

```js
webpack.validateSchema(optionsSchema, options);
```


###webpack-dev-server的其他配置

 （1）--profile

 添加打包的信息，可以通过[Analyzer分析](https://webpack.github.io/analyse/),是在控制台输出的:
<pre>
1208ms building modules
10ms sealing
10ms optimizing
0ms basic module optimization
0ms module optimization
0ms advanced module optimization
10ms basic chunk optimization
0ms chunk optimization
0ms advanced chunk optimization
0ms module and chunk tree optimization
20ms module reviving
0ms module order optimization
0ms module id optimization
0ms chunk reviving
10ms chunk order optimization
0ms chunk id optimization
20ms hashing
0ms module assets processing
20ms chunk assets processing
0ms additional chunk assets processing
10ms recording
0ms additional asset processing
0ms chunk asset optimization
0ms asset optimization
30ms emitting   
</pre>

下面处理的方式：

```js
  //添加ProgressPlugin进度插件
    if(argv["progress"]) {
        compiler.apply(new webpack.ProgressPlugin({
            profile: argv["profile"]
        }));
    }
```


（2）--progress

添加打包的进度信息。
<pre>
 17% building modules 62/77 modules 15 active ...nt\lib\transport\browser\websoc
 17% building modules 63/77 modules 14 active ...nt\lib\transport\browser\websoc
 17% building modules 64/77 modules 13 active ...nt\lib\transport\browser\websoc
 17% building modules 65/77 modules 12 active ...nt\lib\transport\browser\websoc
 17% building modules 66/77 modules 11 active ...nt\lib\transport\browser\websoc
 18% building modules 67/77 modules 10 active ...nt\lib\transport\browser\websoc
</pre>


 （3）--open

 打包完成后打开我们的URL，通过opn完成

 （4）--public

 ```js
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
    const uri = createDomain(options) + (options.inline !== false || options.lazy === true ? "/" : "/webpack-dev-server/");
    //inline模式或者lazy模式url是"/"
 ```

如果我们运行下面的命令:

```js
webpack-dev-server  --public www.hello.com --open//此时会打开www.hello.com
```

我们看看用处：

<pre>
When using inline mode and you're proxying dev-server, the inline client script does not always know where to connect to. It will try to guess the URL of the server based on window.location, but if that fails you'll need to use this.

For example, the dev-server is proxied by nginx, and available on myapp.test:

public: "myapp.test:80"
</pre>

（5）--socket

```js
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

```

下面是server.listen代码:

```js
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
```


(6)--setup

```js
    setup: function() {
            if(typeof options.setup === "function")
                options.setup(app, this);//传入我们的服务器和Server对象
        }.bind(this)
```

<pre>
Here you can access the Express app object and add your own custom middleware to it. For example, to define custom handlers for some paths:

setup(app){
  app.get('/some/path', function(req, res) {
    res.json({ custom: 'response' });
  });
}
</pre>

(7)--staticOptions

```js
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
        }
```

只有当contentBase是文件的时候有用，其会被传入到我们的express.static方法中作为第二个参数。[可以再这里阅读](http://expressjs.com/en/4x/api.html#express.static)

（8）--stats

```js
if(typeof options.stats === "object" && typeof options.stats.colors === "undefined")
        options.stats.colors = argv.color;
  //设置颜色
    if(!options.stats) {
    options.stats = {
        cached: false,
        cachedAssets: false
    };
}
//会传入到webpack中处理
if(e instanceof webpack.WebpackOptionsValidationError) {
            console.error(colorError(options.stats.colors, e.message));
            process.exit(1); // eslint-disable-line
        }
```

<pre>
This option lets you precisely control what bundle information gets displayed. This can be a nice middle ground if you want some bundle information, but not all of it.

To show only errors in your bundle:

stats: "errors-only"
</pre>

（9）--watchContentBase

```js
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

    Server.prototype._watch = function(path) {
    const watcher = chokidar.watch(path).on("change", function() {
        this.sockWrite(this.sockets, "content-changed");
    }.bind(this))
    //通知client端文件变化，每次文件变化都会返回一个watcher对象
    this.contentBaseWatchers.push(watcher);
}
```

我们看看client端是如何处理的：

```js
    //客户端检测到服务器端有更新,通过chokidar检测到文件的变化
    "content-changed": function() {
        log("info", "[WDS] Content base changed. Reloading...")
        self.location.reload();
    }
```


(10)--watchOptions 

传入webpack进行处理。
<pre>
 Control options related to watching the files.

webpack uses the file system to get notified of file changes. In some cases this does not work. For example, when using Network File System (NFS). Vagrant also has a lot of problems with this. In these cases, use polling:

watchOptions: {
  poll: true
}
If this is too heavy on the file system, you can change this to an integer to set the interval in milliseconds.
</pre>