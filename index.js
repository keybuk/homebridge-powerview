var PowerViewHub = require('./PowerViewHub').PowerViewHub;
var Accessory, Service, Characteristic, UUIDGen;

let ShadePollIntervalMs = null; //30000;

let Shade = {
	ROLLER: 1,
	DUETTE: 2
}

let SubType = {
	BOTTOM: 'bottom',
	TOP: 'top'
}

let Position = {
	BOTTOM: 1,
	TOP: 2
}

// TODO:
// - battery status in shadeData:
//   "batteryStatus": 3,
//   "batteryStrength": 182,
// - signal strength in shadeData (not always - maybe not if via repeater?):
//   "signalStrength": 4,


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
			this.updateShades();
			this.updateHubInfo();
		}.bind(this));
	}
}

// Returns the Shade type from the given shade data.
PowerViewPlatform.prototype.shadeType = function(shade) {
	switch (shade.type) {
		case 5:
		case 42:
			return Shade.ROLLER;
		case 8:
			return Shade.DUETTE;
		default:
			this.log("Unknown shade type %d, assuming roller", shade.type);
			return Shade.ROLLER
	}
}


// Called when a cached accessory is loaded to set up callbacks.
PowerViewPlatform.prototype.configureAccessory = function(accessory) {
	this.log("Cached shade %s: %s", accessory.context.shadeId, accessory.displayName);

	accessory.reachable = true;

	if (!accessory.context.shadeType) {
		// Port over a pre-typing shade.
		var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.TOP);
		if (service) {
			accessory.context.shadeType = Shade.DUETTE;
		} else {
			accessory.context.shadeType = Shade.ROLLER;
		}
	}

	this.configureShadeAccessory(accessory);
}

// Adds a new shade accessory.
PowerViewPlatform.prototype.addShadeAccessory = function(shade) {
	var name = Buffer.from(shade.name, 'base64').toString();
	this.log("Adding shade %s: %s", shade.id, name);

	var uuid = UUIDGen.generate(name);

	var accessory = new Accessory(name, uuid);
	accessory.context.shadeId = shade.id;
	accessory.context.shadeType = this.shadeType(shade);

	this.configureShadeAccessory(accessory);
	this.api.registerPlatformAccessories("homebridge-powerview", "PowerView", [accessory]);

	return accessory;
}

// Updates an existing shade accessory.
PowerViewPlatform.prototype.updateShadeAcccessory = function(shade) {
	var accessory = this.accessories[shade.id];
	this.log("Updating shade %s: %s", shade.id, accessory.displayName);

	// If the shade changes type, remove the features that it should not have.
	var newType = this.shadeType(shade);
	if (newType != accessory.context.shadeType) {
		this.log("Shade changed type %d -> %d", accessory.context.shadeType, newType);

		if (accessory.context.shadeType == Shade.DUETTE) {
			accessory.removeService(accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.TOP));
		}

		accessory.context.shadeType = newType;

		this.configureShadeAccessory(accessory);
	}

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
	if (!service)
		service = accessory.addService(Service.WindowCovering, accessory.displayName, SubType.BOTTOM);

	service
		.getCharacteristic(Characteristic.CurrentPosition)
		.removeAllListeners('get')
		.on('get', this.getPosition.bind(this, accessory.context.shadeId, Position.BOTTOM));

	service
		.getCharacteristic(Characteristic.TargetPosition)
		.removeAllListeners('set')
		.on('set', this.setPosition.bind(this, accessory.context.shadeId, Position.BOTTOM));

	if (accessory.context.shadeType == Shade.DUETTE) {
		service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.TOP);
		if (!service)
			service = accessory.addService(Service.WindowCovering, accessory.displayName, SubType.TOP);

		service
			.getCharacteristic(Characteristic.CurrentPosition)
			.removeAllListeners('get')
			.on('get', this.getPosition.bind(this, accessory.context.shadeId, Position.TOP));

		service
			.getCharacteristic(Characteristic.TargetPosition)
			.removeAllListeners('set')
			.on('set', this.setPosition.bind(this, accessory.context.shadeId, Position.TOP));
	}
}

// Updates the values of shade accessory characteristics.
PowerViewPlatform.prototype.updateShadeValues = function(shade, current) {
	var accessory = this.accessories[shade.id];

	var positions = null;
	if (shade.positions) {
		this.log("Set for", shade.id, {'positions': shade.positions});
		positions = {};

		for (var i = 1; shade.positions['posKind'+i]; ++i) {
			var position = shade.positions['posKind'+i];
			var hubValue = shade.positions['position'+i];

			if (position == Position.BOTTOM) {
				var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.BOTTOM);

				positions[Position.BOTTOM] = Math.round(100 * (hubValue / 65535));
				this.log("%s/%d = %d (%d)", shade.id, Position.BOTTOM, positions[Position.BOTTOM], hubValue);

				if (current)
					service.updateCharacteristic(Characteristic.CurrentPosition, position);
				service.updateCharacteristic(Characteristic.TargetPosition, position);
				service.updateCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
			}

			if (position == Position.TOP && accessory.context.shadeType == Shade.DUETTE) {
				var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.TOP);

				positions[Position.TOP] = Math.round(100 * (hubValue / 65535));
				this.log("%s/%d = %d (%d)", shade.id, Position.TOP, positions[Position.TOP], hubValue);

				if (current)
					service.updateCharacteristic(Characteristic.CurrentPosition, position);
				service.updateCharacteristic(Characteristic.TargetPosition, position);
				service.updateCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
			}
		}
	}

	// Set the AccessoryInformation service.
	var service = accessory.getService(Service.AccessoryInformation);
	service.setCharacteristic(Characteristic.Manufacturer, "Hunter Douglas");

	if (shade.firmware) {
		with (shade.firmware) {
			var version = revision.toString() + "." + subRevision.toString() + "." + build.toString();

			service.setCharacteristic(Characteristic.FirmwareRevision, version);
		}
	}


	if (this.hubVersion) {
		service.setCharacteristic(Characteristic.Model, this.hubVersion);
	}

	if (this.hubSerialNumber) {
		service.setCharacteristic(Characteristic.SerialNumber, this.hubSerialNumber);
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

// Gets the hub information, and updates the accessories.
PowerViewPlatform.prototype.updateHubInfo = function(callback) {
	this.hub.getUserData(function(err, userData) {
		if (!err) {
			this.hubName = Buffer.from(userData.hubName, 'base64').toString();
			this.hubSerialNumber = userData.serialNumber;
			this.hubVersion = userData.firmware.mainProcessor.name;

			this.log("Hub: %s", this.hubName);

			for (var shadeId in this.accessories) {
				this.updateShadeValues({ id: shadeId });
			}
		}

		if (callback) callback(err);
	}.bind(this));
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
PowerViewPlatform.prototype.getPosition = function(shadeId, position, callback) {
	this.log("getPosition %s/%d", shadeId, position);

	this.updateShade(shadeId, function(err, positions) {
		if (!err) {
			callback(null, positions[position]);
		} else {
			callback(err);
		}
	}.bind(this));
}

// Characteristic callback for TargetPosition.set
PowerViewPlatform.prototype.setPosition = function(shadeId, position, value, callback) {
	this.log("setPosition %s/%d = %d", shadeId, position, value);
	switch (position) {
		case Position.BOTTOM:
			var hubValue = Math.round(65535 * value / 100);
			break;
		case Position.TOP:
			var hubValue = Math.round(65535 * value / 100);
			break;
	}

	this.hub.putShadePosition(shadeId, position, hubValue, function(err, shade) {
		if (!err) {
			this.updateShadeValues(shade, true);
			callback(null);
		} else {
			callback(err);
		}
	}.bind(this));
}
