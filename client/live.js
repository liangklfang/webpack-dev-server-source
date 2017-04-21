var $ = require("jquery");
var stripAnsi = require("strip-ansi");
var socket = require("./socket");
require("./style.css");
//live.bundle.js
var hot = false;
var currentHash = "";

$(function() {
	$("body").html(require("./page.pug")());
	var status = $("#status");
	var okness = $("#okness");
	var $errors = $("#errors");
	var iframe = $("#iframe");
	var header = $(".header");

	var contentPage = window.location.pathname.substr("/webpack-dev-server".length) + window.location.search;
    //获取webpack-dev-server后面的path和query字符串，也就是说如果是iframe类型的那么我们的iframe的
    //src只会含有path+query+hash这些部分
	status.text("Connecting to sockjs server...");
	$errors.hide();
	iframe.hide();
	header.css({
		borderColor: "#96b5b4"
	});

	var onSocketMsg = {
		hot: function() {
			hot = true;
			iframe.attr("src", contentPage + window.location.hash);
		},
		invalid: function() {
			okness.text("");
			status.text("App updated. Recompiling...");
			header.css({
				borderColor: "#96b5b4"
			});
			$errors.hide();
			if(!hot) iframe.hide();
		},
		hash: function(hash) {
			currentHash = hash;
		},
		"still-ok": function() {
			okness.text("");
			status.text("App ready.");
			header.css({
				borderColor: ""
			});
			$errors.hide();
			if(!hot) iframe.show();
		},
		ok: function() {
			okness.text("");
			$errors.hide();
			reloadApp();
		},
		warnings: function() {
			okness.text("Warnings while compiling.");
			$errors.hide();
			reloadApp();
		},
		errors: function(errors) {
			status.text("App updated with errors. No reload!");
			okness.text("Errors while compiling.");
			$errors.text("\n" + stripAnsi(errors.join("\n\n\n")) + "\n\n");
			header.css({
				borderColor: "#ebcb8b"
			});
			$errors.show();
			iframe.hide();
		},
		close: function() {
			status.text("");
			okness.text("Disconnected.");
			$errors.text("\n\n\n  Lost connection to webpack-dev-server.\n  Please restart the server to reestablish connection...\n\n\n\n");
			header.css({
				borderColor: "#ebcb8b"
			});
			$errors.show();
			iframe.hide();
		}
	};

	socket("/sockjs-node", onSocketMsg);
	//接受消息

	iframe.load(function() {
		status.text("App ready.");
		header.css({
			borderColor: ""
		});
		iframe.show();
	});
	//显示iframe

	function reloadApp() {
		if(hot) {
			status.text("App hot update.");
			try {
				//向iframe中发送消息，以webpackHotUpdate开头
				iframe[0].contentWindow.postMessage("webpackHotUpdate" + currentHash, "*");
			} catch(e) {
				console.warn(e);
			}
			iframe.show();
		} else {
			//location.reload就可以了，iframe的src和hash相关
			status.text("App updated. Reloading app...");
			header.css({
				borderColor: "#96b5b4"
			});
			try {
				var old = iframe[0].contentWindow.location + "";
				if(old.indexOf("about") == 0) old = null;
				//如果是about路径，那么我们前一个url也就是old就是null
				iframe.attr("src", old || (contentPage + window.location.hash));
				//src中是通过
				//重新加载
				old && iframe[0].contentWindow.location.reload();
			} catch(e) {
				iframe.attr("src", contentPage + window.location.hash);
			}
		}
	}

});
