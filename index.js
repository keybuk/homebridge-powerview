var hub = require('./PowerViewHub'),
	PowerViewHub = hub.PowerViewHub,
	Position = hub.Position;
var Accessory, Service, Characteristic, UUIDGen;

let ShadePollIntervalMs = 60000;

let Shade = {
	ROLLER: 1,
	DUETTE: 2,
	SILHOUETTE: 3
}

let ShadeTypes = {
	ROLLER: [ 5, 42 ],
	DUETTE: [ 8 ],
	SILHOUETTE: [ 23 ]
}

let SubType = {
	BOTTOM: 'bottom',
	TOP: 'top'
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

		this.refreshShades = config["refreshShades"] ? true : false;
		this.pollShadesForUpdate = config["pollShadesForUpdate"] ? true : false;

		this.forceRollerShades = config["forceRollerShades"] || [];
		this.forceDuetteShades = config["forceDuetteShades"] || [];
		this.forceSilhouetteShades = config["forceSilhouetteShades"] || [];

		this.api.on('didFinishLaunching', function() {
			this.updateHubInfo();
			if (this.pollShadesForUpdate) {
				this.pollShades();
			} else {
				this.updateShades();
			}
		}.bind(this));
	}
}

// Returns the Shade type from the given shade data.
PowerViewPlatform.prototype.shadeType = function(shade) {
	if (this.forceRollerShades.includes(shade.id))
		return Shade.ROLLER;
	if (this.forceDuetteShades.includes(shade.id))
		return Shade.DUETTE;
	if (this.forceSilhouetteShades.includes(shade.id))
		return Shade.SILHOUETTE;

	if (ShadeTypes.ROLLER.includes(shade.type))
		return Shade.ROLLER;
	if (ShadeTypes.DUETTE.includes(shade.type))
		return Shade.DUETTE;
	if (ShadeTypes.SILHOUETTE.includes(shade.type))
		return Shade.SILHOUETTE;

	this.log("*** Shade %d has unknown type %d, assuming roller ***", shade.id, shade.type);
	return Shade.ROLLER
}


// Called when a cached accessory is loaded to set up callbacks.
PowerViewPlatform.prototype.configureAccessory = function(accessory) {
	this.log("Cached shade %d: %s", accessory.context.shadeId, accessory.displayName);

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
	this.log("Adding shade %d: %s", shade.id, name);

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
	this.log("Updating shade %d: %s", shade.id, accessory.displayName);

	var newType = this.shadeType(shade);
	if (newType != accessory.context.shadeType) {
		this.log("Shade changed type %d -> %d", accessory.context.shadeType, newType);
		accessory.context.shadeType = newType;

		this.configureShadeAccessory(accessory);
	}

	return accessory;
}

// Removes an accessory from the platform.
PowerViewPlatform.prototype.removeShadeAccessory = function(accessory) {
	this.log("Removing shade %d: %s", accessory.context.shadeId, accessory.displayName);
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

	if (accessory.context.shadeType == Shade.SILHOUETTE) {
		service
			.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle)
			.removeAllListeners('get')
			.on('get', this.getPosition.bind(this, accessory.context.shadeId, Position.VANES));

		service
			.getCharacteristic(Characteristic.TargetHorizontalTiltAngle)
			.removeAllListeners('set')
			.on('set', this.setPosition.bind(this, accessory.context.shadeId, Position.VANES));
	} else {
		if (service.testCharacteristic(Characteristic.TargetHorizontalTiltAngle)) {
			var characteristic = service.getCharacteristic(Characteristic.TargetHorizontalTiltAngle);
			service.removeCharacteristic(characteristic);
			service.addOptionalCharacteristic(Characteristic.TargetHorizontalTiltAngle);
		}

		if (service.testCharacteristic(Characteristic.CurrentHorizontalTiltAngle)) {
			var characteristic = service.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle);
			service.removeCharacteristic(characteristic);
			service.addOptionalCharacteristic(Characteristic.CurrentHorizontalTiltAngle);
		}
	}

	service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.TOP);
	if (accessory.context.shadeType == Shade.DUETTE) {
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
	} else {
		accessory.removeService(service);
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
				positions[Position.BOTTOM] = Math.round(100 * hubValue / 65535);

				var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.BOTTOM);

				if (current)
					service.setCharacteristic(Characteristic.CurrentPosition, positions[Position.BOTTOM]);
				service.updateCharacteristic(Characteristic.TargetPosition, positions[Position.BOTTOM]);
				service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);

				if (accessory.context.shadeType == Shade.SILHOUETTE) {
					if (current)
						service.setCharacteristic(Characteristic.CurrentHorizontalTiltAngle, 0)
					service.updateCharacteristic(Characteristic.TargetHorizontalTiltAngle, 0);
				}
			}

			if (position == Position.VANES && accessory.context.shadeType == Shade.SILHOUETTE) {
				positions[Position.VANES] = Math.round(90 * hubValue / 32767);

				var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.BOTTOM);

				// Once we have a vane position, the shade must be closed.
				if (current)
					service.setCharacteristic(Characteristic.CurrentPosition, 0);
				service.updateCharacteristic(Characteristic.TargetPosition, 0);
				service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);

				if (current)
					service.setCharacteristic(Characteristic.CurrentHorizontalTiltAngle, positions[Position.VANES]);
				service.updateCharacteristic(Characteristic.TargetHorizontalTiltAngle, positions[Position.VANES]);
			}

			if (position == Position.TOP && accessory.context.shadeType == Shade.DUETTE) {
				positions[Position.TOP] = Math.round(100 * hubValue / 65535);

				var service = accessory.getServiceByUUIDAndSubType(Service.WindowCovering, SubType.TOP);

				if (current)
					service.setCharacteristic(Characteristic.CurrentPosition, positions[Position.TOP]);
				service.updateCharacteristic(Characteristic.TargetPosition, positions[Position.TOP]);
				service.setCharacteristic(Characteristic.PositionState, Characteristic.PositionState.STOPPED);
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

// Regularly polls shades for changes.
PowerViewPlatform.prototype.pollShades = function() {
	this.updateShades(function() {
		setTimeout(function() {
			this.pollShades();
		}.bind(this), ShadePollIntervalMs);
	}.bind(this));
}

// Gets the hub information, and updates the accessories.
PowerViewPlatform.prototype.updateHubInfo = function(callback) {
	this.hub.getUserData(function(err, userData) {
		if (!err) {
			this.hubName = Buffer.from(userData.hubName, 'base64').toString();
			this.hubSerialNumber = userData.serialNumber;
			if (userData.firmware && userData.firmware.mainProcessor)
				this.hubVersion = userData.firmware.mainProcessor.name;

			this.log("Hub: %s", this.hubName);

			for (var shadeId in this.accessories) {
				this.updateShadeValues({ id: parseInt(shadeId) });
			}
		}

		if (callback) callback(err);
	}.bind(this));
}

// Gets the current shade information, and updates values.
PowerViewPlatform.prototype.updateShade = function(shadeId, refresh = false, callback) {
	this.hub.getShade(shadeId, refresh, function(err, shade) {
		if (!err) {
			var positions = this.updateShadeValues(shade);
			var timedOut = refresh ? shade.timedOut : null;
			if (callback) callback(null, positions, timedOut);
		} else {
			if (callback) callback(err);
		}
	}.bind(this));
}

// Gets a single shade position, updating values along the way.
PowerViewPlatform.prototype.updatePosition = function(shadeId, position, refresh = false, callback) {
	this.updateShade(shadeId, refresh, function(err, positions, timedOut) {
		if (!err) {
			// Treat a number of other issues as errors.
			if (refresh && timedOut) {
				this.log("Timeout for %d/%d", shadeId, position);
				if (callback) callback(new Error("Timed out"));
			} else if (!positions) {
				if (callback) callback(new Error("Positions not available"));
			} else {
				if (callback) callback(null, positions[position]);
			}
		} else {
			if (callback) callback(err);
		}
	}.bind(this));
}

// Jogs the shade to update the shade information, and updates values.
PowerViewPlatform.prototype.jogShade = function(shadeId, callback) {
	this.hub.jogShade(shadeId, function(err, shade) {
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
	this.log("getPosition %d/%d", shadeId, position);

	this.updatePosition(shadeId, position, this.refreshShades, function(err, value) {
		if (!err) {
			// If we're not refreshing by default, try again with a refresh.
			if (!this.refreshShades && value == null) {
				this.log("refresh %d/%d", shadeId, position);
				this.updatePosition(shadeId, position, true, callback);
			} else {
				callback(null, value);
			}
		} else {
			callback(err);
		}
	}.bind(this));
}

// Characteristic callback for TargetPosition.set
PowerViewPlatform.prototype.setPosition = function(shadeId, position, value, callback) {
	this.log("setPosition %d/%d = %d", shadeId, position, value);
	switch (position) {
		case Position.BOTTOM:
			var hubValue = Math.round(65535 * value / 100);
			break;
		case Position.TOP:
			var hubValue = Math.round(65535 * value / 100);
			break;
		case Position.VANES:
			var hubValue = Math.round(32767 * value / 90);
			break;
	}

	this.hub.putShade(shadeId, position, hubValue, function(err, shade) {
		if (!err) {
			this.updateShadeValues(shade, true);
			callback(null);
		} else {
			callback(err);
		}
	}.bind(this));
}
