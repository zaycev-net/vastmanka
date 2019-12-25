'use strict';

var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var {VASTClient} = require('vast-client');
var JavaScriptVPAIDPlayer = require('./players/JavaScriptVPAID');
var FlashVPAIDPlayer = require('./players/FlashVPAID');
var HTMLAudioPlayer = require('./players/HTMLAudio');
var HTMLVideoPlayer = require('./players/HTMLVideo');
var MIME = require('./enums/MIME');
var EVENTS = require('./enums/VPAID_EVENTS');
var EventProxy = require('./EventProxy');
var PixelReporter = require('./PixelReporter');

var vastClient = new VASTClient();

function defaults() {
	var result = {};
	var length = arguments.length;
	var index, object;
	var prop, value;

	for (index = 0; index < length; index++) {
		object = arguments[index] || {};

		for (prop in object) {
			value = object[prop];

			if (result[prop] === undefined) {
				result[prop] = value;
			}

			if (typeof value === 'object') {
				result[prop] = defaults(result[prop], value);
			}
		}
	}

	return result;
}

function identity(value) {
	return value;
}

function getNotReadyError() {
	return new Error('VASTPlayer not ready.');
}

function proxy(method) {
	return function callMethod() {
		var self = this;
		var player = this.__private__.player;

		if (!this.ready) {
			return Promise.reject(getNotReadyError());
		}

		return player[method].apply(player, arguments).then(function () {
			return self;
		});
	};
}

function proxyProp(property) {
	return {
		get: function get() {
			if (!this.ready) {
				throw getNotReadyError();
			}

			return this.__private__.player[property];
		},

		set: function set(value) {
			if (!this.ready) {
				throw getNotReadyError();
			}

			return (this.__private__.player[property] = value);
		}
	};
}

function VASTPlayer(container, config) {
	var self = this;

	EventEmitter.call(this); // call super()

	this.__private__ = {
		container: container,
		config: defaults(config, {
			vast: {
				resolveWrappers: true,
				maxRedirects: 5
			},
			tracking: {
				mapper: identity
			}
		}),

		vast: null,
		ready: false,
		player: null
	};

	this.on(EVENTS.AdClickThru, function onAdClickThru(url, id, playerHandles) {
		var clickThrough = url || self.vast.get('ads[0].creatives[0].videoClickThroughURLTemplate');

		if (playerHandles && clickThrough) {
			window.open(clickThrough);
		}
	});
}

inherits(VASTPlayer, EventEmitter);
Object.defineProperties(VASTPlayer.prototype, {
	container: {
		get: function getContainer() {
			return this.__private__.container;
		}
	},

	config: {
		get: function getConfig() {
			return this.__private__.config;
		}
	},

	vast: {
		get: function getVast() {
			return this.__private__.vast;
		}
	},

	ready: {
		get: function getReady() {
			return this.__private__.ready;
		}
	},

	adRemainingTime: proxyProp('adRemainingTime'),
	adDuration: proxyProp('adDuration'),
	adVolume: proxyProp('adVolume')
});

VASTPlayer.prototype.load = function load(uri) {
	var self = this;
	var config = this.config.vast;
	var vastResponseText;
	if (typeof uri == 'array') {
		var arrayForCallback = uri.length > 1 ? uri.slice(1) : false;
		uri = uri[0];
	}

	return vastClient.get(uri)
		.then(vast => {
			function get(prop) {
				var parts = (prop || '').match(/[^\[\]\.]+/g) || [];

				return parts.reduce(function (result, part) {
					return (result || undefined) && result[part];
				}, vast);
			}

			function map(prop, mapper) {
				var array = get(prop) || [];
				var length = array.length;
				var result = [];

				if (!(array instanceof Array)) {
					return result;
				}

				var index = 0;
				for (; index < length; index++) {
					result.push(mapper.call(vast, array[index], index, array));
				}

				return result;
			}

			function filter(prop, predicate) {
				var array = get(prop) || [];
				var length = array.length;
				var result = [];

				if (!(array instanceof Array)) {
					return result;
				}

				var index = 0;
				for (; index < length; index++) {
					if (predicate.call(vast, array[index], index, array)) {
						result.push(array[index]);
					}
				}

				return result;
			}

			var config = (function () {
				var jsVPAIDFiles = filter('ads[0].creatives[0].mediaFiles', function (mediaFile) {
					return (
						mediaFile.type === MIME.JAVASCRIPT ||
						mediaFile.type === 'application/x-javascript'
					) && mediaFile.apiFramework === 'VPAID';
				});
				var swfVPAIDFiles = filter('ads[0].creatives[0].mediaFiles', function (mediaFile) {
					return mediaFile.type === MIME.FLASH && mediaFile.apiFramework === 'VPAID';
				});
				var files = filter('ads[0].creatives[0].mediaFiles', function () {
					return true;
				});

				if (jsVPAIDFiles.length > 0) {
					return {
						player: new JavaScriptVPAIDPlayer(self.container),
						mediaFiles: jsVPAIDFiles
					};
				} else if (swfVPAIDFiles.length > 0) {
					return {
						player: new FlashVPAIDPlayer(self.container, VASTPlayer.vpaidSWFLocation),
						mediaFiles: swfVPAIDFiles
					};
				}
				var icons = filter('ads[0].creatives[0].icons', function (icons) {
					return icons;
				});

				if (icons.length) {
					files[0].icons = icons;

					return {
						player: new HTMLAudioPlayer(self.container),
						mediaFiles: files
					};
				}

				return {
					player: new HTMLVideoPlayer(self.container),
					mediaFiles: files
				};
			}());
			var parameters = get('ads[0].creatives[0].adParameters');
			var pixels = [].concat(
				map('ads[0].impressionURLTemplates', function (impression) {
					return {event: 'impression', uri: impression};
				}),
				map('ads[0].errorURLTemplates', function (uri) {
					return {event: 'error', uri: uri};
				}),
				get('ads[0].creatives[0].trackingEvents'),
				map('ads[0].creatives[0].videoClickTrackingURLTemplates', function (uri) {
					return {event: 'clickThrough', uri: uri};
				})
			);
			var player = config.player;
			var mediaFiles = config.mediaFiles;
			var proxy = new EventProxy(EVENTS);
			var reporter = new PixelReporter(pixels, self.config.tracking.mapper);

			proxy.from(player).to(self);

			self.__private__.vast = vast;
			self.__private__.vast.get = get;
			self.__private__.vast.filter = filter;
			self.__private__.vast.map = map;
			self.__private__.player = player;

			return player.load(mediaFiles, parameters).then(function setupPixels() {
				reporter.track(player);
			});
		})
		.then(function setReady() {
			self.__private__.ready = true;
			self.emit('ready');

			return self;
		})
		.catch(function emitError(reason) {
			if (arrayForCallback && arrayForCallback.length) {
				return VASTPlayer.prototype.load(arrayForCallback);
			}
			self.emit('error', reason);

			console.log(reason);

			throw reason;
		});
};

VASTPlayer.prototype.startAd = proxy('startAd');

VASTPlayer.prototype.stopAd = proxy('stopAd');

VASTPlayer.prototype.pauseAd = proxy('pauseAd');

VASTPlayer.prototype.resumeAd = proxy('resumeAd');

VASTPlayer.vpaidSWFLocation = 'https://cdn.jsdelivr.net/npm/vast-player@__VERSION__/dist/vast-player--vpaid.swf';

module.exports = VASTPlayer;
