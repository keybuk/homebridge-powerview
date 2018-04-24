var PowerViewHub = require('./PowerViewHub').PowerViewHub;
var Accessory, Service, Characteristic, UUIDGen;

let ShadePollIntervalMs = null; //30000;

let BottomServiceSubtype = 'bottom';
let TopServiceSubtype = 'top';

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

	this.shades = [];

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

 	this.useShadeAccessory(accessory);
}

// Call to remove an accessory from the platform.
PowerViewPlatform.prototype.removeAccessory = function(accessory) {
	this.log("Removing accessory %s", accessory.displayName);
	this.api.unregisterPlatformAccessories("homebridge-powerview", "PowerView", [accessory]);

	this.shades[accessory.context.shadeId] = null;
}

// Adds a new shade accessory.
PowerViewPlatform.prototype.addShadeAccessory = function(shadeData) {
	var name = Buffer.from(shadeData.name, 'base64').toString();
	var shadeId = shadeData.id;
	this.log("Adding shade %s: %s", shadeId, name);

	var uuid = UUIDGen.generate(name);

	var accessory = new Accessory(name, uuid);
	accessory.context.shadeId = shadeId;

	if (shadeData.positions == null) {
		this.log("Missing position data in shade data, about to crash", shadeData);
	}

	// FIXME this should move into useShadeAccessory
	if (shadeData.positions.posKind2 == 2) {
		accessory.addService(Service.WindowCovering, name, BottomServiceSubtype);
		accessory.addService(Service.WindowCovering, name, TopServiceSubtype);
	} else {
		accessory.addService(Service.WindowCovering, name, BottomServiceSubtype);
	}

	this.useShadeAccessory(accessory, shadeData);
	this.api.registerPlatformAccessories("homebridge-powerview", "PowerView", [accessory]);

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
		// FIXME we don't wait for this callback
		this.updateShade(shadeId);
	}

	// FIXME the services may have changed since last time, wait for the updateShade and add/remove
	// accessories?
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


// Gets the current set of shades, and updates the accessories.
PowerViewPlatform.prototype.updateShades = function(callback) {
	this.hub.getShades(function(err, shadeData) {
		if (!err) {
			var newShades = [];
			for (var shadeData of shadeData) {
				var shadeId = shadeData.id;

				if (this.shades[shadeId] == null) {
					this.log("Found new shade: %s", shadeId);
					newShades[shadeId] = this.addShadeAccessory(shadeData);
				} else {
					this.log("Updating existing shade: %s", shadeId);
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
		}

		if (callback) callback(err);
	}.bind(this));
}

// Gets the current shade information, and updates values.
PowerViewPlatform.prototype.updateShade = function(shadeId, callback) {
	thus.hub.getShade(shadeId, function(err, shade) {
		if (!err) {
			this.log("Update response: %s", shadeId);
			this.setShade(shadeId, shade);
			if (callback) callback(null, shade);
		} else {
			if (callback) callback(err);
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

		this.log("now %s/%d = %d (%d)", shadeId, 1, position, shadeData.positions.position1);

		service.updateCharacteristic(Characteristic.CurrentPosition, position);
		service.updateCharacteristic(Characteristic.TargetPosition, position);
	}

	service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, TopServiceSubtype);
	if (service != null && shadeData.positions.position2 != null) {
		var position = Math.round(100 * (shadeData.positions.position2 / 65535));
		this.shades[shadeId].positions[2] = position;

		this.log("now %s/%d = %d (%d)", shadeId, 2, position, shadeData.positions.position2);

		service.updateCharacteristic(Characteristic.CurrentPosition, position);
		service.updateCharacteristic(Characteristic.TargetPosition, position);
	}
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

// Characteristic callback for TargetPosition.set
PowerViewPlatform.prototype.setPosition = function(shadeId, position, value, callback) {
	this.log("setPosition %s/%d = %d", shadeId, position, value);
	var hubValue = Math.round(65535 * (value / 100));

	this.hub.putShadePosition(shadeId, position, hubValue, function(err, shade) {
		if (!err) {
			this.setShade(shadeId, shade);
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
