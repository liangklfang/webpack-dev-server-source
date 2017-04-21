 var path = require('path');
    var webpack = require('webpack');
    const compiler = webpack({
        entry: [
            process.cwd()+'/index.js'      
        ],
        resolve:{
          modules:["node_modules",process.cwd()+'/node_modules']
        },
        output: {
            path:  process.cwd()+'/dist',  //输出路径
            filename: '[name].bundle.js'     //输出文件名，文件可以自己定义，[name]的意思是与入口文件的文件对应，可以不用[name]，
        },
       module: {
            rules: [
                
                { test: /\.html?$/, loader: `${require.resolve('html-loader')}?name=[name].[ext]` },
            ]
        }
    },function(){
       console.log('webpack打包完成');
    });
console.log('compiler.outputPath====',compiler.compilers);
  compiler.plugin('done', function doneHandler(stats) {
       console.log('webpack进入到done阶段');
      if (stats.hasErrors()) {
        console.log("webpack打包错误，错误信息为:",stats.toString({colors: true}));
      }
    });