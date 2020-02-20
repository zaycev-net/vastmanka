'use strict';

var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var canPlay = require('../environment').canPlay;
var sortBy = require('sort-by');
var VPAID_EVENTS = require('../enums/VPAID_EVENTS');
var HTML_MEDIA_EVENTS = require('../enums/HTML_MEDIA_EVENTS');
var HTMLVideoTracker = require('../HTMLVideoTracker');
var EventProxy = require('../EventProxy');

var isUnlockedAudio = false;
var audio = document.createElement('audio');

function listenerMoveMouse() {
	if (!isUnlockedAudio && audio) {
		isUnlockedAudio = true;

		audio.play();

		window.removeEventListener('click', listenerMoveMouse, false);
	}
}

window.addEventListener('click', listenerMoveMouse, false);

function on(audio, event, handler) {
	return audio.addEventListener(event, handler, false);
}

function off(audio, event, handler) {
	return audio.removeEventListener(event, handler, false);
}

function once(audio, event, handler) {
	return on(audio, event, function onevent() {
		off(audio, event, onevent);
		return handler.apply(this, arguments);
	});
}

function method(implementation, promiseify) {
	function getError() {
		return new Error('The <audio> has not been loaded.');
	}

	return function callImplementation(/*...args*/) {
		if (!this.audio) {
			if (promiseify) {
				return Promise.reject(getError());
			} else {
				throw getError();
			}
		}

		return implementation.apply(this, arguments);
	};
}

function pickaudioUri(mediaFiles, dimensions) {
	var width = dimensions.width;
	var items = mediaFiles.map(function (audioUri) {
		return {
			audioUri: audioUri,
			playability: canPlay(audioUri.type)
		};
	}).filter(function (config) {
		return config.playability > 0;
	}).sort(sortBy('-playability', '-audioUri.bitrate'));
	var distances = items.map(function (item) {
		return Math.abs(width - item.audioUri.width);
	});
	var item = items[distances.indexOf(Math.min.apply(Math, distances))];

	return (!item || item.playability < 1) ? null : item.audioUri;
}

function HTMLAudio(container) {
	this.container = container;
	this.audio = null;

	this.__private__ = {
		hasPlayed: false
	};
}

inherits(HTMLAudio, EventEmitter);
Object.defineProperties(HTMLAudio.prototype, {
	adRemainingTime: {
		get: method(function getAdRemainingTime() {
			return this.audio.duration - this.audio.currentTime;
		})
	},
	adDuration: {
		get: method(function getAdDuration() {
			return this.audio.duration;
		})
	},
	adVolume: {
		get: method(function getAdVolume() {
			return this.audio.volume;
		}),
		set: method(function setAdVolume(volume) {
			this.audio.volume = volume;
		})
	}
});

HTMLAudio.prototype.load = function load(mediaFiles) {
	var self = this;

	return new Promise(function loadCreative(resolve, reject) {
		var audioUri = mediaFiles[0].fileURL.trim();
		var img;
		var windowWidth;

		if (!audioUri) {
			return reject(new Error('There are no playable <audioUri>s.'));
		}

		audio.src = audioUri;
		audio.preload = 'auto';

		if (mediaFiles[0].icons.length) {
			var tempIcons = mediaFiles[0].icons.slice().reverse();
			img = document.createElement('img');

			windowWidth = document.getElementsByTagName('body')[0].getBoundingClientRect().width;
			for (var i = 0; i < tempIcons.length; i++) {
				if (windowWidth > tempIcons[i].width) {
					img.src = tempIcons[i].staticResource;
					img.style.width = tempIcons[i].width + 'px';
					img.style.height = tempIcons[i].height + 'px';

					i = tempIcons.length;
				}
			}
		}

		once(audio, HTML_MEDIA_EVENTS.LOADEDMETADATA, function onloadedmetadata() {
			var tracker = new HTMLVideoTracker(audio);
			var proxy = new EventProxy(VPAID_EVENTS);

			proxy.from(tracker).to(self);

			self.audio = audio;
			self.img = img;
			resolve(self);

			self.emit(VPAID_EVENTS.AdLoaded);

			function ontimeupdate() {
				self.emit(VPAID_EVENTS.AdTimeUpdate);

				once(audio, HTML_MEDIA_EVENTS.ENDED, function ended() {
					off(audio, HTML_MEDIA_EVENTS.TIMEUPDATE, ontimeupdate);
				});
			}

			on(audio, HTML_MEDIA_EVENTS.TIMEUPDATE, ontimeupdate);
			on(audio, HTML_MEDIA_EVENTS.DURATIONCHANGE, function ondurationchange() {
				self.emit(VPAID_EVENTS.AdDurationChange);
			});
			on(audio, HTML_MEDIA_EVENTS.VOLUMECHANGE, function onvolumechange() {
				self.emit(VPAID_EVENTS.AdVolumeChange);
			});
		});

		once(audio, HTML_MEDIA_EVENTS.ERROR, function onerror() {
			var error = audio.error;

			self.emit(VPAID_EVENTS.AdError, error.message);
			reject(error);
		});

		once(audio, HTML_MEDIA_EVENTS.PLAYING, function onplaying() {
			self.__private__.hasPlayed = true;
			self.emit(VPAID_EVENTS.AdImpression);
		});

		once(audio, HTML_MEDIA_EVENTS.ENDED, function onended() {
			self.stopAd();
		});

		on(img, 'click', function onclick() {
			self.emit(VPAID_EVENTS.AdClickThru, null, null, true);
		});

		self.container.appendChild(audio);
		self.container.appendChild(img);
	});
};

HTMLAudio.prototype.startAd = method(function startAd() {
	var self = this;
	var audio = this.audio;

	if (this.__private__.hasPlayed) {
		return Promise.reject(new Error('The ad has already been started.'));
	}

	return new Promise(function callPlay(resolve) {
		once(audio, HTML_MEDIA_EVENTS.PLAYING, function onplaying() {
			resolve(self);
			self.emit(VPAID_EVENTS.AdStarted);
		});

		return audio.play();
	});
}, true);

HTMLAudio.prototype.stopAd = method(function stopAd() {
	this.container.removeChild(this.audio);
	this.emit(VPAID_EVENTS.AdStopped);

	return Promise.resolve(this);
}, true);

HTMLAudio.prototype.stopAd = method(function setVolume(volume) {
	this.container.removeChild(this.audio);
	this.emit(VPAID_EVENTS.AdStopped);

	return Promise.resolve(this);
}, true);

HTMLAudio.prototype.pauseAd = method(function pauseAd() {
	var self = this;
	var audio = this.audio;

	if (this.audio.paused) {
		return Promise.resolve(this);
	}

	return new Promise(function callPause(resolve) {
		once(audio, HTML_MEDIA_EVENTS.PAUSE, function onpause() {
			resolve(self);
			self.emit(VPAID_EVENTS.AdPaused);
		});

		return audio.pause();
	});
}, true);

HTMLAudio.prototype.resumeAd = method(function resumeAd() {
	var self = this;
	var audio = this.audio;

	if (!this.__private__.hasPlayed) {
		return Promise.reject(new Error('The ad has not been started yet.'));
	}

	if (!this.audio.paused) {
		return Promise.resolve(this);
	}

	return new Promise(function callPlay(resolve) {
		once(audio, HTML_MEDIA_EVENTS.PLAY, function onplay() {
			resolve(self);
			self.emit(VPAID_EVENTS.AdPlaying);
		});

		return audio.play();
	});
}, true);

module.exports = HTMLAudio;
