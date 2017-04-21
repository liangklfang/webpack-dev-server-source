// var urlParse = require("url").parse;
// var publicPath = "/assets/";
// var url = urlParse(publicPath || "/", false, true);
// console.log('url==',url);

var urlParse = require("url").parse;
var pathJoin = require("./PathJoin");
function getFilenameFromUrl(publicPath, outputPath, url) {
	var url="http://localhost:8080/assets/lib/";
	var filename;
	var localPrefix = urlParse(publicPath || "/", false, true);
	var urlObject = urlParse(url);
	// publicPath has the hostname that is not the same as request url's, should fail
	// 访问的url的hostname和publicPath中配置的host不一致，直接返回
	if(localPrefix.hostname !== null && urlObject.hostname !== null &&
		localPrefix.hostname !== urlObject.hostname) {
		return false;
	}
	// publicPath is not in url, so it should fail
	if(publicPath && localPrefix.hostname === urlObject.hostname && url.indexOf(publicPath) !== 0) {
		return false;
	}

	// strip localPrefix from the start of url
	// 如果url中的pathname和publicPath一致，那么请求成功，文件名为urlObject中除去publicPath那一部分的结果
	if(urlObject.pathname.indexOf(localPrefix.pathname) === 0) {
		filename = urlObject.pathname.substr(localPrefix.pathname.length);
	}

	if(!urlObject.hostname && localPrefix.hostname &&
		url.indexOf(localPrefix.path) !== 0) {
		return false;
	}
	return filename ? pathJoin(outputPath, filename) : outputPath;
}

console.log('++++++++++++++++',getFilenameFromUrl('/assets/'));
//得到 /lib/index.js