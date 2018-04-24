var request = require('request');

module.exports = {
	PowerViewHub: PowerViewHub
}

let InitialRequestDelayMs = 100;
let RequestIntervalMs = 100;


function PowerViewHub(log, host) {
	this.log = log;
	this.host = host;

	this.queue = [];
}

// Queue a shades API request.
PowerViewHub.prototype.queueRequest = function(queued) {
	if (!this.queue.length)
		this.scheduleRequest(InitialRequestDelayMs);

	this.queue.push(queued);
}

// Schedules a shades API PUT request.
PowerViewHub.prototype.scheduleRequest = function(delay) {
	setTimeout(function() {
		// Take the first queue item, and remove the data so that future requests don't try and modify it.
		// Leave an object in the queue though so queueRequest() doesnt schedule this method while the
		// request is in-flight, since we re-schedule ourselves if the queue has items.
		var queued = this.queue[0];
		this.queue[0] = {};

		var options = {
			url: "http://" + this.host + "/api/shades/" + queued.shadeId
		}
		
		if (queued.data) {
			options.method = 'PUT';
			options.json = { 'shade': queued.data };
		}

		if (queued.qs) {
			options.qs = queued.qs;
		}

		request(options, function(err, response, body) {
			if (!err && response.statusCode == 200) {
				var json = queued.data ? body : JSON.parse(body);
				for (var callback of queued.callbacks) {
					callback(null, json.shade);
				}
			} else {
				this.log("Error setting position (status code %s): %s", response ? response.statusCode : "-", err);
				for (var callback of queued.callbacks) {
					callback(err);
				}
			}

			this.queue.shift();
			if (this.queue.length > 0) {
				this.scheduleRequest(RequestIntervalMs);
			}
		}.bind(this));
	}.bind(this), delay);
}


// Makes a userdata API request.
PowerViewHub.prototype.getUserData = function(callback) {
	request.get({
		url: "http://" + this.host + "/api/userdata"
	}, function(err, response, body) {
		if (!err && response.statusCode == 200) {
			var json = JSON.parse(body);

			if (callback) callback(null, json.userData);
		} else {
			this.log("Error getting userdata (status code %s): %s", response ? response.statusCode : "-", err);
			if (callback) callback(err);
		}
	}.bind(this));
}

// Makes a shades API request.
PowerViewHub.prototype.getShades = function(callback) {
	request.get({
		url: "http://" + this.host + "/api/shades"
	}, function(err, response, body) {
		if (!err && response.statusCode == 200) {
			var json = JSON.parse(body);

			if (callback) callback(null, json.shadeData);
		} else {
			this.log("Error getting shades (status code %s): %s", response ? response.statusCode : "-", err);
			if (callback) callback(err);
		}
	}.bind(this));
}

// Makes a shades API request for a single shade.
PowerViewHub.prototype.getShade = function(shadeId, callback) {
	request.get({
		url: "http://" + this.host + "/api/shades/" + shadeId,
	}, function(err, response, body) {
		if (!err && response.statusCode == 200) {
			this.log("Received shade information: %s", shadeId);
			var json = JSON.parse(body);

			if (callback) callback(null, json.shade);
		} else {
			this.log("Error getting shade (status code %s): %s", response ? response.statusCode : "-", err);
			if (callback) callback(err);
		}
	}.bind(this));
}

// Makes a shades API request to change the position of a single shade.
// Requests are queued so only one is in flight at a time, and they are smart merged.
PowerViewHub.prototype.putShade = function(shadeId, position, value, callback) {
	for (var queued of this.queue) {
		if (queued.shadeId == shadeId && queued.data && queued.data.positions) {
			// Overwrite the same position if it's queued, otherwise append a new one.
			for (var i = 1; queued.data.positions['posKind'+i]; ++i) {
				if (queued.data.positions['posKind'+i] == position)
					break;
			}

			queued.data.positions['posKind'+i] = position;
			queued.data.positions['position'+i] = value;

			queued.callbacks.push(callback);
			return;
		}
	}

	var queued = {
		'shadeId': shadeId,
		'data': {
			'positions': {
				'posKind1': position,
				'position1': value
			}
		},
		'callbacks': [callback]
	}


	this.queueRequest(queued);
}

// Makes a shades API request to jog a shade.
PowerViewHub.prototype.jogShade = function(shadeId, callback) {
	for (var queued of this.queue) {
		if (queued.shadeId == shadeId && queued.data && queued.data.motion == 'jog') {
			queued.callbacks.push(callback);
			return;
		}
	}

	var queued = {
		'shadeId': shadeId,
		'data': { 'motion': 'jog' },
		'callbacks': [callback]
	}
	this.queueRequest(queued);
}

// Makes a shades API request to calibrate a shade.
PowerViewHub.prototype.calibrateShade = function(shadeId, callback) {
	for (var queued of this.queue) {
		if (queued.shadeId == shadeId && queued.data && queued.data.motion == 'calibrate') {
			queued.callbacks.push(callback);
			return;
		}
	}

	var queued = {
		'shadeId': shadeId,
		'data': { 'motion': 'calibrate' },
		'callbacks': [callback]
	}
	this.queueRequest(queued);
}
