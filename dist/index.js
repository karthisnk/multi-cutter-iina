!function(){iina.console;var i=iina.menu,n=iina.core,t=iina.standaloneWindow;function e(){t.postMessage("currentTime",{time:n.status.position})}t.setFrame(400,200),t.loadFile("dist/ui/window/index.html"),e();var o=i.item("Start Recording",function(){t.open()},{keyBinding:"Alt+Shift+r"});i.addItem(o),setInterval(function(){e()},500)}();
//# sourceMappingURL=index.js.map
