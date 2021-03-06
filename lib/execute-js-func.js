'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RecursiveProxyHandler = undefined;

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

/**
 * Given an object path and arguments, actually invokes the method and returns
 * the result. This method is run on the target side (i.e. not the one doing
 * the invoking). This method tries to figure out the return value of an object
 * and do the right thing, including awaiting Promises to get their values.
 *
 * @param  {string} path  A path to the object to execute, in dotted
 *                        form i.e. 'document.querySelector'.
 * @param  {Array}  args  The arguments to pass to the method
 *
 * @return {Promise<object>}      The result of evaluating path(...args)
 *
 * @private
 */
let evalRemoteMethod = (() => {
  var _ref7 = _asyncToGenerator(function* (path, args) {
    var _objectAndParentGiven = objectAndParentGivenPath(path),
        _objectAndParentGiven2 = _slicedToArray(_objectAndParentGiven, 2);

    let parent = _objectAndParentGiven2[0],
        obj = _objectAndParentGiven2[1];


    let result = obj;
    if (obj && typeof obj === 'function') {
      d("obj is function!");
      let res = obj.apply(parent, args);

      result = res;
      if (typeof res === 'object' && res && 'then' in res) {
        d("result is Promise!");
        result = yield res;
      }
    }

    return result;
  });

  return function evalRemoteMethod(_x5, _x6) {
    return _ref7.apply(this, arguments);
  };
})();

/**
 * Invokes a method on a module in the main process.
 *
 * @param {string} moduleName         The name of the module to require
 * @param {Array<string>} methodChain The path to the module, e.g., ['dock', 'bounce']
 * @param {Array} args                The arguments to pass to the method
 *
 * @returns                           The result of calling the method
 *
 * @private
 */


exports.getSenderIdentifier = getSenderIdentifier;
exports.setParentInformation = setParentInformation;
exports.remoteEvalObservable = remoteEvalObservable;
exports.remoteEval = remoteEval;
exports.executeJavaScriptMethodObservable = executeJavaScriptMethodObservable;
exports.executeJavaScriptMethod = executeJavaScriptMethod;
exports.createProxyForRemote = createProxyForRemote;
exports.createProxyForMainProcessModule = createProxyForMainProcessModule;
exports.initializeEvalHandler = initializeEvalHandler;

var _Observable = require('rxjs/Observable');

var _Subscription = require('rxjs/Subscription');

var _hashids = require('hashids');

var _hashids2 = _interopRequireDefault(_hashids);

var _lodash = require('lodash.get');

var _lodash2 = _interopRequireDefault(_lodash);

require('rxjs/add/observable/of');

require('rxjs/add/observable/throw');

require('rxjs/add/operator/catch');

require('rxjs/add/operator/do');

require('rxjs/add/operator/filter');

require('rxjs/add/operator/take');

require('rxjs/add/operator/mergeMap');

require('rxjs/add/operator/timeout');

require('rxjs/add/operator/toPromise');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const requestChannel = 'execute-javascript-request';
const responseChannel = 'execute-javascript-response';
const rootEvalProxyName = 'electron-remote-eval-proxy';
const requireElectronModule = '__requireElectronModule__';

const electron = require('electron');
const isBrowser = process.type === 'browser';
const ipc = electron[isBrowser ? 'ipcMain' : 'ipcRenderer'];

const d = require('debug')('electron-remote:execute-js-func');
const webContents = isBrowser ? electron.webContents : electron.remote.webContents;

let nextId = 1;
const hashIds = new _hashids2.default();

function getNextId() {
  return hashIds.encode(process.pid, nextId++);
}

/**
 * Determines the identifier for the current process (i.e. the thing we can use
 * to route messages to it)
 *
 * @return {object} An object with either a `guestInstanceId` or a `webContentsId`
 */
function getSenderIdentifier() {
  if (isBrowser) return {};

  if (process.guestInstanceId) {
    return { guestInstanceId: process.guestInstanceId };
  }

  return {
    webContentsId: require('electron').remote.getCurrentWebContents().id
  };
}

/**
 * Determines a way to send a reply back from an incoming eval request.
 *
 * @param  {Object} request   An object returned from {getSenderIdentifier}
 *
 * @return {Function}         A function that act like ipc.send, but to a
 *                            particular process.
 *
 * @private
 */
function getReplyMethod(request) {
  let target = findTargetFromParentInfo(request);

  if (target) {
    return function () {
      if ('isDestroyed' in target && target.isDestroyed()) return;
      target.send(...arguments);
    };
  } else {
    d("Using reply to main process");
    return function () {
      return ipc.send(...arguments);
    };
  }
}

/**
 * Turns an IPC channel into an Observable
 *
 * @param  {String} channel     The IPC channel to listen to via `ipc.on`
 *
 * @return {Observable<Array>}  An Observable which sends IPC args via `onNext`
 *
 * @private
 */
function listenToIpc(channel) {
  return _Observable.Observable.create(subj => {
    let listener = function (event) {
      for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }

      d(`Got an event for ${channel}: ${JSON.stringify(args)}`);
      subj.next(args);
    };

    d(`Setting up listener! ${channel}`);
    ipc.on(channel, listener);

    return new _Subscription.Subscription(() => ipc.removeListener(channel, listener));
  });
}

/**
 * Returns a method that will act like `ipc.send` depending on the parameter
 * passed to it, so you don't have to check for `webContents`.
 *
 * @param  {BrowserWindow|WebView} windowOrWebView    The renderer to send to.
 *
 * @return {Function}                                 A function that behaves like
 *                                                    `ipc.send`.
 *
 * @private
 */
function getSendMethod(windowOrWebView) {
  if (!windowOrWebView) return function () {
    return ipc.send(...arguments);
  };

  if ('webContents' in windowOrWebView) {
    return function () {
      for (var _len2 = arguments.length, a = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        a[_key2] = arguments[_key2];
      }

      d(`webContents send: ${JSON.stringify(a)}`);
      if (!windowOrWebView.webContents.isDestroyed()) {
        windowOrWebView.webContents.send(...a);
      } else {
        throw new Error(`WebContents has been destroyed`);
      }
    };
  } else {
    return function () {
      for (var _len3 = arguments.length, a = Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
        a[_key3] = arguments[_key3];
      }

      d(`webView send: ${JSON.stringify(a)}`);
      windowOrWebView.send(...a);
    };
  }
}

/**
 * This method creates an Observable Promise that represents a future response
 * to a remoted call. It filters on ID, then cancels itself once either a
 * response is returned, or it times out.
 *
 * @param  {Guid} id                                  The ID of the sent request
 * @param  {Number} timeout                           The timeout in milliseconds
 *
 * @return {Observable}                               An Observable Promise
 *                                                    representing the result, or
 *                                                    an OnError with the error.
 *
 * @private
 */
function listenerForId(id, timeout) {
  return listenToIpc(responseChannel).do((_ref) => {
    var _ref2 = _slicedToArray(_ref, 1);

    let x = _ref2[0];
    return d(`Got IPC! ${x.id} === ${id}; ${JSON.stringify(x)}`);
  }).filter((_ref3) => {
    var _ref4 = _slicedToArray(_ref3, 1);

    let receive = _ref4[0];
    return receive.id === id && id;
  }).take(1).mergeMap((_ref5) => {
    var _ref6 = _slicedToArray(_ref5, 1);

    let receive = _ref6[0];

    if (receive.error) {
      let e = new Error(receive.error.message);
      e.stack = receive.error.stack;
      return _Observable.Observable.throw(e);
    }

    return _Observable.Observable.of(receive.result);
  }).timeout(timeout);
}

/**
 * Given the parentInfo returned from {getSenderIdentifier}, returns the actual
 * WebContents that it represents.
 *
 * @param  {object} parentInfo  The renderer process identifying info.
 *
 * @return {WebContents}        An actual Renderer Process object.
 *
 * @private
 */
function findTargetFromParentInfo() {
  let parentInfo = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : window.parentInfo;

  if (!parentInfo) return null;
  if ('guestInstanceId' in parentInfo) {
    return require('electron').remote.getGuestWebContents(parentInfo.guestInstanceId);
  }

  if ('webContentsId' in parentInfo) {
    return webContents.fromId(parentInfo.webContentsId);
  }

  return null;
}

/**
 * Configures a child renderer process who to send replies to. Call this method
 * when you want child windows to be able to use their parent as an implicit
 * target.
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to configure
 */
function setParentInformation(windowOrWebView) {
  let info = getSenderIdentifier();
  let ret;

  if (info.guestInstanceId) {
    ret = remoteEval(windowOrWebView, `window.parentInfo = { guestInstanceId: ${info.guestInstanceId} }`);
  } else if (info.webContentsId) {
    ret = remoteEval(windowOrWebView, `window.parentInfo = { webContentsId: ${info.webContentsId} }`);
  } else {
    ret = remoteEval(windowOrWebView, `window.parentInfo = {}`);
  }

  return ret.catch(err => d(`Unable to set parentInfo: ${err.stack || err.message}`));
}

/**
 * Evaluates a string `eval`-style in a remote renderer process.
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code in.
 * @param  {string} str                             The code to execute.
 * @param  {Number} timeout                         The timeout in milliseconds
 *
 * @return {Observable}                             The result of the evaluation.
 *                                                  Must be JSON-serializable.
 */
function remoteEvalObservable(windowOrWebView, str) {
  let timeout = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 5 * 1000;

  let send = getSendMethod(windowOrWebView || findTargetFromParentInfo());
  if (!send) {
    return _Observable.Observable.throw(new Error(`Unable to find a target for: ${JSON.stringify(window.parentInfo)}`));
  }

  if (!str || str.length < 1) {
    return _Observable.Observable.throw(new Error("RemoteEval called with empty or null code"));
  }

  let toSend = Object.assign({ id: getNextId(), eval: str }, getSenderIdentifier());
  let ret = listenerForId(toSend.id, timeout);

  d(`Sending: ${JSON.stringify(toSend)}`);
  send(requestChannel, toSend);
  return ret;
}

/**
 * Evaluates a string `eval`-style in a remote renderer process.
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code in.
 * @param  {string} str                             The code to execute.
 * @param  {Number} timeout                         The timeout in milliseconds
 *
 * @return {Promise}                             The result of the evaluation.
 *                                               Must be JSON-serializable.
 */
function remoteEval(windowOrWebView, str) {
  let timeout = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : 5 * 1000;

  return remoteEvalObservable(windowOrWebView, str, timeout).toPromise();
}

/**
 * Evaluates a JavaScript method on a remote object and returns the result. this
 * method can be used to either execute Functions in remote renderers, or return
 * values from objects. For example:
 *
 * let userAgent = await executeJavaScriptMethod(wnd, 'navigator.userAgent');
 *
 * executeJavaScriptMethod will also be smart enough to recognize when methods
 * themselves return Promises and await them:
 *
 * let fetchResult = await executeJavaScriptMethod('window.fetchHtml', 'https://google.com');
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code
 *                                                  in. If this parameter is
 *                                                  null, this will reference
 *                                                  the browser process.
 * @param  {Number} timeout         Timeout in milliseconds
 * @param  {string} pathToObject    A path to the object to execute, in dotted
 *                                  form i.e. 'document.querySelector'.
 * @param  {Array} args             The arguments to pass to the method
 *
 * @return {Observable}                The result of evaluating the method or
 *                                     property. Must be JSON serializable.
 */
function executeJavaScriptMethodObservable(windowOrWebView, timeout, pathToObject) {
  for (var _len4 = arguments.length, args = Array(_len4 > 3 ? _len4 - 3 : 0), _key4 = 3; _key4 < _len4; _key4++) {
    args[_key4 - 3] = arguments[_key4];
  }

  let send = getSendMethod(windowOrWebView || findTargetFromParentInfo());
  if (!send) {
    return _Observable.Observable.throw(new Error(`Unable to find a target for: ${JSON.stringify(window.parentInfo)}`));
  }

  if (Array.isArray(pathToObject)) {
    pathToObject = pathToObject.join('.');
  }

  if (!pathToObject.match(/^[a-zA-Z0-9\._]+$/)) {
    return _Observable.Observable.throw(new Error(`pathToObject must be of the form foo.bar.baz (got ${pathToObject})`));
  }

  let toSend = Object.assign({ args, id: getNextId(), path: pathToObject }, getSenderIdentifier());
  let ret = listenerForId(toSend.id, timeout);

  d(`Sending: ${JSON.stringify(toSend)}`);
  send(requestChannel, toSend);
  return ret;
}

/**
 * Evaluates a JavaScript method on a remote object and returns the result. this
 * method can be used to either execute Functions in remote renderers, or return
 * values from objects. For example:
 *
 * let userAgent = await executeJavaScriptMethod(wnd, 'navigator.userAgent');
 *
 * executeJavaScriptMethod will also be smart enough to recognize when methods
 * themselves return Promises and await them:
 *
 * let fetchResult = await executeJavaScriptMethod('window.fetchHtml', 'https://google.com');
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code
 *                                                  in. If this parameter is
 *                                                  null, this will reference
 *                                                  the browser process.
 * @param  {string} pathToObject    A path to the object to execute, in dotted
 *                                  form i.e. 'document.querySelector'.
 * @param  {Array} args             The arguments to pass to the method
 *
 * @return {Promise}                The result of evaluating the method or
 *                                  property. Must be JSON serializable.
 */
function executeJavaScriptMethod(windowOrWebView, pathToObject) {
  for (var _len5 = arguments.length, args = Array(_len5 > 2 ? _len5 - 2 : 0), _key5 = 2; _key5 < _len5; _key5++) {
    args[_key5 - 2] = arguments[_key5];
  }

  return executeJavaScriptMethodObservable(windowOrWebView, 5 * 1000, pathToObject, ...args).toPromise();
}

/**
 * Creates an object that is a representation of the remote process's 'window'
 * object that allows you to remotely invoke methods.
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code
 *                                                  in. If this parameter is
 *                                                  null, this will reference
 *                                                  the browser process.
 * @param  {number} timeout     The timeout to use, defaults to 240sec
 *
 * @return {Object}     A Proxy object that will invoke methods remotely.
 *                      Similar to {executeJavaScriptMethod}, methods will return
 *                      a Promise even if the target method returns a normal
 *                      value.
 */
function createProxyForRemote(windowOrWebView) {
  let timeout = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 240 * 1000;

  return RecursiveProxyHandler.create(rootEvalProxyName, (methodChain, args) => {
    let chain = methodChain.splice(1);

    d(`Invoking ${chain.join('.')}(${JSON.stringify(args)})`);
    return executeJavaScriptMethodObservable(windowOrWebView, timeout, chain, ...args).toPromise();
  });
}

/**
 * Creates an object that is a representation of a module in the main process,
 * but with all of its methods Promisified.
 *
 * @param {String} moduleName The name of the main process module to proxy
 * @returns {Object}          A Proxy object that will invoke methods remotely.
 *                            All methods will return a Promise.
 */
function createProxyForMainProcessModule(moduleName) {
  return createProxyForRemote(null)[requireElectronModule][moduleName];
}

/**
 * Walks the global object hierarchy to resolve the actual object that a dotted
 * object path refers to.
 *
 * @param  {string} path  A path to the object to execute, in dotted
 *                        form i.e. 'document.querySelector'.
 *
 * @return {Array<string>}      Returns the actual method object and its parent,
 *                              usually a Function and its `this` parameter, as
 *                              `[parent, obj]`
 *
 * @private
 */
function objectAndParentGivenPath(path) {
  let obj = global || window;
  let parent = obj;

  for (let part of path.split('.')) {
    parent = obj;
    obj = obj[part];
  }

  d(`parent: ${parent}, obj: ${obj}`);
  if (typeof parent !== 'object') {
    throw new Error(`Couldn't access part of the object window.${path}`);
  }

  return [parent, obj];
}function executeMainProcessMethod(moduleName, methodChain, args) {
  const theModule = electron[moduleName];
  const path = methodChain.join('.');
  return (0, _lodash2.default)(theModule, path).apply(theModule, args);
}

/**
 * Initializes the IPC listener that {executeJavaScriptMethod} will send IPC
 * messages to. You need to call this method in any process that you want to
 * execute remote methods on.
 *
 * @return {Subscription}   An object that you can call `unsubscribe` on to clean up
 *                          the listener early. Usually not necessary.
 */
function initializeEvalHandler() {
  let listener = (() => {
    var _ref8 = _asyncToGenerator(function* (e, receive) {
      d(`Got Message! ${JSON.stringify(receive)}`);
      let send = getReplyMethod(receive);

      try {
        if (receive.eval) {
          receive.result = eval(receive.eval);
        } else {
          const parts = receive.path.split('.');
          if (parts.length > 1 && parts[0] === requireElectronModule) {
            receive.result = executeMainProcessMethod(parts[1], parts.splice(2), receive.args);
          } else {
            receive.result = yield evalRemoteMethod(receive.path, receive.args);
          }
        }

        d(`Replying! ${JSON.stringify(receive)} - ID is ${e.sender}`);
        send(responseChannel, receive);
      } catch (err) {
        receive.error = {
          message: err.message,
          stack: err.stack
        };

        d(`Failed! ${JSON.stringify(receive)}`);
        send(responseChannel, receive);
      }
    });

    return function listener(_x7, _x8) {
      return _ref8.apply(this, arguments);
    };
  })();

  d("Set up listener!");
  ipc.on('execute-javascript-request', listener);

  return new _Subscription.Subscription(() => ipc.removeListener('execute-javascript-request', listener));
}

const emptyFn = function () {};

/**
 * RecursiveProxyHandler is a ES6 Proxy Handler object that intercepts method
 * invocations and returns the full object that was invoked. So this means, if you
 * get a proxy, then execute `foo.bar.bamf(5)`, you'll recieve a callback with
 * the parameters "foo.bar.bamf" as a string, and [5].
 */
class RecursiveProxyHandler {
  /**
   * Creates a new RecursiveProxyHandler. Don't use this, use `create`
   *
   * @private
   */
  constructor(name, methodHandler) {
    let parent = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;
    let overrides = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : null;

    this.name = name;
    this.proxies = {};
    this.methodHandler = methodHandler;
    this.parent = parent;
    this.overrides = overrides;
  }

  /**
   * Creates an ES6 Proxy which is handled by RecursiveProxyHandler.
   *
   * @param  {string} name             The root object name
   * @param  {Function} methodHandler  The Function to handle method invocations -
   *                                   this method will receive an Array<String> of
   *                                   object names which will point to the Function
   *                                   on the Proxy being invoked.
   *
   * @param  {Object} overrides        An optional object that lets you directly
   *                                   include functions on the top-level object, its
   *                                   keys are key names for the property, and
   *                                   the values are what the key on the property
   *                                   should return.
   *
   * @return {Proxy}                   An ES6 Proxy object that uses
   *                                   RecursiveProxyHandler.
   */
  static create(name, methodHandler) {
    let overrides = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;

    return new Proxy(emptyFn, new RecursiveProxyHandler(name, methodHandler, null, overrides));
  }

  /**
   * The {get} ES6 Proxy handler.
   *
   * @private
   */
  get(target, prop) {
    if (this.overrides && prop in this.overrides) {
      return this.overrides[prop];
    }

    return new Proxy(emptyFn, this.getOrCreateProxyHandler(prop));
  }

  /**
   * The {apply} ES6 Proxy handler.
   *
   * @private
   */
  apply(target, thisArg, argList) {
    let methodChain = [this.replaceGetterWithName(this.name)];
    let iter = this.parent;

    while (iter) {
      methodChain.unshift(iter.name);
      iter = iter.parent;
    }

    return this.methodHandler(methodChain, argList);
  }

  /**
   * Creates a proxy for a returned `get` call.
   *
   * @param  {string} name  The property name
   * @return {RecursiveProxyHandler}
   *
   * @private
   */
  getOrCreateProxyHandler(name) {
    let ret = this.proxies[name];
    if (ret) return ret;

    ret = new RecursiveProxyHandler(name, this.methodHandler, this);
    this.proxies[name] = ret;
    return ret;
  }

  /**
   * Because we don't support directly getting values by-name, we convert any
   * call of the form "getXyz" into a call for the value 'xyz'
   *
   * @return {string} The name of the actual method or property to evaluate.
   * @private
   */
  replaceGetterWithName(name) {
    return name.replace(/_get$/, '');
  }
}
exports.RecursiveProxyHandler = RecursiveProxyHandler;