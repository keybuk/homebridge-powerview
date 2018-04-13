var request = require('request');
var Accessory, Service, Characteristic, UUIDGen;

let ShadePollIntervalMs = 30000;
let SceneCoalesceDelayMs = 10;

let BottomServiceSubtype = 'bottom';
let TopServiceSubtype = 'top';

// TODO:
// - meta-data

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;

	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	UUIDGen = homebridge.hap.uuid;

	homebridge.registerPlatform("homebridge-powerview", "PowerView", PowerViewPlatform, true);
}

function PowerViewPlatform(log, config, api) {
	log("PowerView init");
	this.log = log;
	this.config = config;
	this.api = api;

	this.host = config["host"];

	this.shades = [];
	this.delayed = [];
	
	this.api.on('didFinishLaunching', function() {
		this.log("PowerView didFinishLaunching");
		this.updateShades(function(err) {
			this.pollShades();
		}.bind(this));
	}.bind(this));
}

// Called when a cached accessory is loaded to set up callbacks.
PowerViewPlatform.prototype.configureAccessory = function(accessory) {
  this.log("Configure Accessory %s", accessory.displayName);

  accessory.reachable = true;

  this.useShadeAccessory(accessory);
}

// Call to add an accessory to the platform.
PowerViewPlatform.prototype.addAccessory = function(accessory) {
	this.log("Add Accessory %s", accessory.displayName);

	this.api.registerPlatformAccessories("homebridge-powerview", "PowerView", [accessory]);
}

// Call to remove an accessory from the platform.
PowerViewPlatform.prototype.removeAccessory = function(accessory) {
	this.log("Removing accessory %s", accessory.displayName);
	this.api.unregisterPlatformAccessories("homebridge-powerview", "PowerView", [accessory]);

	this.shades[accessory.context.shadeId] = null;
}

// Create and add a shade accessory.
PowerViewPlatform.prototype.addShade = function(shadeData) {
	var name = Buffer.from(shadeData.name, 'base64').toString();
	var shadeId = shadeData.id;
	this.log("Adding shade %s: %s", shadeId, name);

	var uuid = UUIDGen.generate(name);

	var accessory = new Accessory(name, uuid);
	accessory.context.shadeId = shadeId;

	if (shadeData.positions.posKind2 == 2) {
		accessory.addService(Service.WindowCovering, name, BottomServiceSubtype);
		accessory.addService(Service.WindowCovering, name, TopServiceSubtype);
	} else {
		accessory.addService(Service.WindowCovering, name, BottomServiceSubtype);
	}

	this.useShadeAccessory(accessory, shadeData);
	this.addAccessory(accessory);

	return accessory;
}

// Set up callbacks for a shade accessory.
PowerViewPlatform.prototype.useShadeAccessory = function(accessory, shadeData) {
	this.log("Use accessory %s", accessory.displayName);

	var shadeId = accessory.context.shadeId;
	this.shades[shadeId] = [];
	this.shades[shadeId].accessory = accessory;
	this.shades[shadeId].positions = [];

	if (shadeData != null) {
		this.shades[shadeId].data = shadeData;
		this.setShade(shadeId, shadeData);
	} else {
		this.updateShade(shadeId);
	}

	var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, BottomServiceSubtype);
	if (service != null) {
		service
			.getCharacteristic(Characteristic.CurrentPosition)
			.on('get', this.getPosition.bind(this, accessory.context.shadeId, 1));

		service
			.getCharacteristic(Characteristic.TargetPosition)
			.on('get', this.getPosition.bind(this, accessory.context.shadeId, 1))
			.on('set', this.setPosition.bind(this, accessory.context.shadeId, 1));

		service
			.getCharacteristic(Characteristic.PositionState)
			.on('get', this.getState.bind(this, accessory.context.shadeId, 1));
	}

	service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, TopServiceSubtype);
	if (service != null) {
		service
			.getCharacteristic(Characteristic.CurrentPosition)
			.on('get', this.getPosition.bind(this, accessory.context.shadeId, 2));

		service
			.getCharacteristic(Characteristic.TargetPosition)
			.on('get', this.getPosition.bind(this, accessory.context.shadeId, 2))
			.on('set', this.setPosition.bind(this, accessory.context.shadeId, 2));

		service
			.getCharacteristic(Characteristic.PositionState)
			.on('get', this.getState.bind(this, accessory.context.shadeId, 2));
	}
}


// Fetch the full set of shade data.
PowerViewPlatform.prototype.updateShades = function(callback) {
	this.log("Updating shades");

	request.get({
		url: "http://" + this.host + "/api/shades"
	}, function(err, response, body) {
		if (!err && response.statusCode == 200) {
			var newShades = [];
			var json = JSON.parse(body);
			for (var shadeData of json.shadeData) {
				var shadeId = shadeData.id;

				if (this.shades[shadeId] == null) {
					this.log("Found new shade: %s", shadeId);
					newShades[shadeId] = this.addShade(shadeData);
				} else {
					newShades[shadeId] = this.shades[shadeId];
				}

				this.setShade(shadeId, shadeData);
			}

			for (var shadeId in this.shades) {
				if (newShades[shadeId] == null) {
					this.log("Shade was removed: %s", shadeId);
					this.removeAccessory(this.shades[shadeId].accessory);
				}
			}

			if (callback != null) {
				callback(null);
			}
		} else {
			this.log("Error getting shades (status code %s): %s", response.statusCode, err);
			if (callback != null) {
				callback(err);
			}
		}
	}.bind(this));
}

// Fetch the data of a single shade.
PowerViewPlatform.prototype.updateShade = function(shadeId, callback) {
	this.log("Updating shade: %s", shadeId);

	request.get({
		url: "http://" + this.host + "/api/shades/" + shadeId
	}, function(err, response, body) {
		if (!err && response.statusCode == 200) {
			var json = JSON.parse(body);

			this.setShade(shadeId, json.shade);
			if (callback != null) {
				callback(null, json.shade);
			}
		} else {
			this.log("Error getting shade (status code %s): %s", response.statusCode, err);
			if (callback != null) {
				callback(err);
			}
		}
	}.bind(this));
}

// Update the cached data and characteristic values for a shade.
PowerViewPlatform.prototype.setShade = function(shadeId, shadeData) {
	var accessory = this.shades[shadeId].accessory;
	this.shades[shadeId].data = shadeData;

	var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, BottomServiceSubtype);
	if (service != null && shadeData.positions.position1 != null) {
		var position = Math.round(100 * (shadeData.positions.position1 / 65535));
		this.shades[shadeId].positions[1] = position;

		service.updateCharacteristic(Characteristic.CurrentPosition, position);
		service.updateCharacteristic(Characteristic.TargetPosition, position);
	}

	service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, TopServiceSubtype);
	if (service != null && shadeData.positions.position2 != null) {
		var position = Math.round(100 * (shadeData.positions.position2 / 65535));
		this.shades[shadeId].positions[2] = position;

		service.updateCharacteristic(Characteristic.CurrentPosition, position);
		service.updateCharacteristic(Characteristic.TargetPosition, position);
	}
}

// Regularly poll shades for changes.
PowerViewPlatform.prototype.pollShades = function() {
	setTimeout(function() {
		this.updateShades(function(err) {
			this.pollShades();
		}.bind(this));
	}.bind(this), ShadePollIntervalMs);
}


// Characteristic callback for CurrentPosition.get
PowerViewPlatform.prototype.getPosition = function(shadeId, positionId, callback) {
	this.log("getPosition %s/%d", shadeId, positionId);

	this.updateShade(shadeId, function(err, shadeData) {
		if (!err) {
			callback(null, this.shades[shadeId].positions[positionId]);
		} else {
			callback(err);
		}
	}.bind(this));
}

PowerViewPlatform.prototype.setPosition = function(shadeId, positionId, position, callback) {
	this.log("setPosition %s/%d = %d", shadeId, positionId, position);

	// Handle delaying an update.
	var data = this.delayed[shadeId];
	if (data == null) {
		data = { "shade": { "positions": { } } };
		data.shade.positions = this.shades[shadeId].data.positions;
	}

	data.shade.positions["posKind" + positionId] = positionId;
	data.shade.positions["position" + positionId] = Math.round(65535 * (position / 100));

	if (this.delayed[shadeId] != null) {
		callback(null);
	} else {
		this.delayed[shadeId] = data;

		setTimeout(function(shadeId) {
			this.log("Delayed setPosition %s", shadeId);

			var data = this.delayed[shadeId];
			this.delayed[shadeId] = null;

			request({
				url: "http://" + this.host + "/api/shades/" + shadeId,
				method: 'PUT',
				json: data
			}, function(err, response, body) {
				if (!err && response.statusCode == 200) {
					var json = body;
					this.setShade(shadeId, json.shade);

					callback(null);
				} else {
					this.log("Error setting position (status code %s): %s", response.statusCode, err);
					callback(err);
				}
			}.bind(this));
		}.bind(this), SceneCoalesceDelayMs, shadeId);
	}
}

PowerViewPlatform.prototype.getState = function(shadeId, positionId, callback) {
	this.log("getState %s/%d", shadeId, positionId);
	callback(null, Characteristic.PositionState.STOPPED);
}
