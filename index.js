var PowerViewHub = require('./PowerViewHub').PowerViewHub;
var Accessory, Service, Characteristic, UUIDGen;

let ShadePollIntervalMs = null; //30000;

let SubType = {
	BOTTOM: 'bottom',
	TOP: 'top'
}

// TODO:
// - HomeKit meta-data:
//   Manufacturer
//   Serial Number
//   Model
// - firmware version in shadeData:
//    "firmware": { "build": 0, "index": 32, "revision": 2, "subRevision": 1 },
//    = 2.1.0
//     "firmware": { "build": 1944, "revision": 1, "subRevision": 8 },
//    = 1.8.1944
// - battery status in shadeData:
//   "batteryStatus": 3,
//   "batteryStrength": 182,
// - signal strength in shadeData (not always - maybe not if via repeater?):
//   "signalStrength": 4,

// Shade types:
// 5 = Roller, Screen & Banded Shades
//     (one position open-closed)
// 8 = Duette & Appaulse honeycone shades
//     (two positions, both open-closed)

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

	this.accessories = [];

	if (config) {
		var host = config["host"] || 'powerview-hub.local';
		this.hub = new PowerViewHub(log, host);

		this.api.on('didFinishLaunching', function() {
			this.log("PowerView didFinishLaunching");
			this.updateShades(function(err) {
				this.pollShades();
			}.bind(this));
		}.bind(this));
	}
}

// Called when a cached accessory is loaded to set up callbacks.
PowerViewPlatform.prototype.configureAccessory = function(accessory) {
	this.log("Cached shade %s: %s", accessory.context.shadeId, accessory.displayName);

	accessory.reachable = true;

 	this.configureShadeAccessory(accessory);
}

// Adds a new shade accessory.
PowerViewPlatform.prototype.addShadeAccessory = function(shade) {
	var name = Buffer.from(shade.name, 'base64').toString();
	this.log("Adding shade %s: %s", shade.id, name);

	var uuid = UUIDGen.generate(name);

	var accessory = new Accessory(name, uuid);
	accessory.context.shadeId = shade.id;

	if (shade.positions == null) {
		this.log("Missing position data in shade data, about to crash", shade);
	}

	// FIXME this should move into useShadeAccessory
	if (shade.positions.posKind2 == 2) {
		accessory.addService(Service.WindowCovering, name, SubType.BOTTOM);
		accessory.addService(Service.WindowCovering, name, SubType.TOP);
	} else {
		accessory.addService(Service.WindowCovering, name, SubType.BOTTOM);
	}

	this.configureShadeAccessory(accessory);
	this.api.registerPlatformAccessories("homebridge-powerview", "PowerView", [accessory]);

	return accessory;
}

// Updates an existing shade accessory.
PowerViewPlatform.prototype.updateShadeAcccessory = function(shade) {
	var accessory = this.accessories[shade.id];
	this.log("Updating shade %s: %s", shade.id, accessory.displayName);

	return accessory;
}

// Removes an accessory from the platform.
PowerViewPlatform.prototype.removeShadeAccessory = function(accessory) {
	this.log("Removing shade %s: %s", accessory.context.shadeId, accessory.displayName);
	this.api.unregisterPlatformAccessories("homebridge-powerview", "PowerView", [accessory]);

	delete this.accessories[accessory.context.shadeId];
}

// Sets up callbacks for a shade accessory.
PowerViewPlatform.prototype.configureShadeAccessory = function(accessory) {
	var shadeId = accessory.context.shadeId;
	this.accessories[shadeId] = accessory;

	var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.BOTTOM);
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

	service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.TOP);
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

// Updates the values of shade accessory characteristics.
PowerViewPlatform.prototype.updateShadeValues = function(shade) {
	var accessory = this.accessories[shade.id];
	var positions = {};

	var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.BOTTOM);
	if (service != null && shade.positions.position1 != null) {
		positions[1] = Math.round(100 * (shade.positions.position1 / 65535));
		this.log("now %s/%d = %d (%d)", shade.id, 1, positions[1], shade.positions.position1);

		service.updateCharacteristic(Characteristic.CurrentPosition, position);
		service.updateCharacteristic(Characteristic.TargetPosition, position);
	}

	service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.TOP);
	if (service != null && shade.positions.position2 != null) {
		positions[2] = Math.round(100 * (shade.positions.position2 / 65535));
		this.log("now %s/%d = %d (%d)", shade.id, 2, positions[2], shade.positions.position2);

		service.updateCharacteristic(Characteristic.CurrentPosition, position);
		service.updateCharacteristic(Characteristic.TargetPosition, position);
	}

	return positions;
}


// Gets the current set of shades, and updates the accessories.
PowerViewPlatform.prototype.updateShades = function(callback) {
	this.hub.getShades(function(err, shadeData) {
		if (!err) {
			var newShades = [];
			for (var shade of shadeData) {
				if (!this.accessories[shade.id]) {
					newShades[shade.id] = this.addShadeAccessory(shade);
				} else {
					newShades[shade.id] = this.updateShadeAcccessory(shade);
				}

				this.updateShadeValues(shade);
			}

			for (var shadeId in this.accessories) {
				if (!newShades[shadeId]) {
					this.removeShadeAccessory(this.accessories[shadeId]);
				}
			}
		}

		if (callback) callback(err);
	}.bind(this));
}

// Regularly poll shades for changes.
PowerViewPlatform.prototype.pollShades = function() {
	if (ShadePollIntervalMs != null) {
		setTimeout(function() {
			this.updateShades(function(err) {
				this.pollShades();
			}.bind(this));
		}.bind(this), ShadePollIntervalMs);
	}
}

// Gets the current shade information, and updates values.
PowerViewPlatform.prototype.updateShade = function(shadeId, callback) {
	thus.hub.getShade(shadeId, function(err, shade) {
		if (!err) {
			var positions = this.updateShadeValues(shade);
			if (callback) callback(null, positions);
		} else {
			if (callback) callback(err);
		}
	}.bind(this));
}


// Characteristic callback for CurrentPosition.get
PowerViewPlatform.prototype.getPosition = function(shadeId, positionId, callback) {
	this.log("getPosition %s/%d", shadeId, positionId);

	this.updateShade(shadeId, function(err, positions) {
		if (!err) {
			callback(null, positions[positionId]);
		} else {
			callback(err);
		}
	}.bind(this));
}

// Characteristic callback for TargetPosition.set
PowerViewPlatform.prototype.setPosition = function(shadeId, position, value, callback) {
	this.log("setPosition %s/%d = %d", shadeId, position, value);
	var hubValue = Math.round(65535 * (value / 100));

	this.hub.putShadePosition(shadeId, position, hubValue, function(err, shade) {
		if (!err) {
			this.updateShadeValues(shade);
			callback(null);
		} else {
			callback(err);
		}
	}.bind(this));
}

PowerViewPlatform.prototype.getState = function(shadeId, positionId, callback) {
	this.log("getState %s/%d", shadeId, positionId);
	callback(null, Characteristic.PositionState.STOPPED);
}
