/*! uppie | (c) 2015 silverwind | BSD license */
/* eslint-env browser, commonjs, amd, worker */
/* eslint-disable strict */
/* globals onmessage: true */

(function (m) {
  if (typeof exports === "object" && typeof module === "object") // CommonJS
    module.exports = m();
  else if (typeof define === "function" && define.amd) // AMD
    return define([], m);
  else // Plain browser environment
    this.Uppie = m();
})(function () {
  "use strict";
  var gfd = "getFilesAndDirectories"; // saves a few bytes after minifying

  return function Uppie(opts) {
    return function (node, cb) {
      if (node.tagName.toLowerCase() === "input" && node.type === "file") {
        node.addEventListener("change", function (event) {
          if (!event.target.files || !event.target.files.length) return;
          if (gfd in event.target) {
            call(newDirectoryApi, event.target, opts, cb);
          } else if ("webkitRelativePath" in event.target.files[0]) {
            call(oldDirectoryApi, event.target, opts, cb);
          } else {
            call(multipleApi, event.target, opts, cb);
          }
        });
      } else {
        var stop = function (event) { event.preventDefault(); };
        node.addEventListener("dragover", stop);
        node.addEventListener("dragenter", stop);
        node.addEventListener("drop", function (event) {
          event.preventDefault();
          var dataTransfer = event.dataTransfer;
          if (gfd in dataTransfer) {
            call(newDirectoryApi, dataTransfer, opts, cb);
          } else if (dataTransfer.items) {
            call(oldDropApi, dataTransfer.items, opts, cb);
          }
        });
      }
    };
  };

  function call(fn, input, opts, cb) {
    if (!opts.worker) return fn(input, opts, cb);
    canUseWorker().then(function (can) {
      if (!can) return fn(input, opts, cb);

      // There be dragons
      fn = String(fn);
      fn = fn.replace(/^.+{\n/g, "");
      fn = "onmessage = function(e) {var input = e.data[0], opts = e.data[1];" + fn;
      fn = fn.replace("cb(fd, files)", "postMessage([fd, files])");
      var worker = createWorker(fn);
      worker.onmessage = function (e) {
        console.log("done");
        cb(e.data[0], e.data[1]);
      };
      console.log(typeof input, input);
      worker.postMessage([input, opts]);
    });
  }

  // API implemented in Firefox 42+ and Edge
  function newDirectoryApi(input, opts, cb) {
    var fd = new FormData(), files = [];
    var iterate = function (entries, path, resolve) {
      var promises = [];
      entries.forEach(function (entry) {
        promises.push(new Promise(function (resolve) {
          if (gfd in entry) { // it's a directory
            entry.getFilesAndDirectories().then(function (entries) {
              if (opts.empty && !entries.length) {
                var p = (path + entry.name + "/").replace(/^\//, "");
                fd.append(entry.name + "/", new Blob(), p);
                files.push(p);
              }
              iterate(entries, entry.path + entry.name + "/", resolve);
            });
          } else { // it's a file
            if (entry.name) {
              var p = (path + entry.name).replace(/^\//, "");
              fd.append(entry.name, entry, p);
              files.push(p);
            }
            resolve();
          }
        }));
      });
      Promise.all(promises).then(resolve.bind());
    };
    input.getFilesAndDirectories().then(function (entries) {
      new Promise(function (resolve) {
        iterate(entries, "/", resolve);
      }).then(function () {
        cb(fd, files);
      });
    });
  }

  // old prefixed API implemented in Chrome 11+
  function oldDirectoryApi(input, opts, cb) {
    var fd = new FormData(), files = [];
    [].slice.call(input.files).forEach(function (file) {
      fd.append(file.name, file, file.webkitRelativePath);
      files.push(file.webkitRelativePath);
    });
    cb(fd, files);
  }

  // fallback for files without directories
  function multipleApi(input, opts, cb) {
    var fd = new FormData(), files = [];
    [].slice.call(input.files).forEach(function (file) {
      fd.append(file.name, file, file.name);
      files.push(file.name);
    });
    cb(fd, files);
  }

  // old drag and drop API implemented in Chrome 11+
  function oldDropApi(input, opts, cb) {
    var fd = new FormData(), files = [], rootPromises = [];

    function readEntries(entry, reader, oldEntries, cb) {
      var dirReader = reader || entry.createReader();
      dirReader.readEntries(function (entries) {
        var newEntries = oldEntries ? oldEntries.concat(entries) : entries;
        if (entries.length) {
          setTimeout(readEntries.bind(null, entry, dirReader, newEntries, cb), 0);
        } else {
          cb(newEntries);
        }
      });
    }

    function readDirectory(entry, path, resolve) {
      if (!path) path = entry.name;
      readEntries(entry, undefined, undefined, function (entries) {
        var promises = [];
        entries.forEach(function (entry) {
          promises.push(new Promise(function (resolve) {
            if (entry.isFile) {
              entry.file(function (file) {
                fd.append(file.name, file, path + "/" + file.name);
                files.push(path + "/" + file.name);
                resolve();
              }, resolve.bind());
            } else readDirectory(entry, path + "/" + entry.name, resolve);
          }));
        });
        if (opts.empty && !entries.length) {
          fd.append(entry.name + "/", new Blob(), path + "/" + entry.name + "/");
          files.push(path + "/" + entry.name + "/");
        }
        Promise.all(promises).then(resolve.bind());
      });
    }

    [].slice.call(input).forEach(function (entry) {
      entry = entry.webkitGetAsEntry();
      if (entry) {
        rootPromises.push(new Promise(function (resolve) {
          if (entry.isFile) {
            entry.file(function (file) {
              fd.append(file.name, file, file.name);
              files.push(file.name);
              resolve();
            }, resolve.bind());
          } else if (entry.isDirectory) {
            readDirectory(entry, null, resolve);
          }
        }));
      }
    });
    Promise.all(rootPromises).then(function () {
      cb(fd, files);
    });
  }

  function createWorker(fn) {
    var str = new Blob(["(", typeof fn === "function" ? String(fn) : fn, ")()"]);
    return new Worker(URL.createObjectURL(str));
  }

  function canUseWorker() {
    return new Promise(function (resolve) {
      createWorker(function () {
        postMessage(typeof FormData === "function");
        close();
      }).onmessage = function (e) {
        resolve(e.data);
      };
    });
  }
});
