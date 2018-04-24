# homebridge-powerview
[![npm](https://img.shields.io/npm/v/homebridge-powerview.svg)](https://www.npmjs.com/package/homebridge-powerview)
[![npm](https://img.shields.io/npm/dt/homebridge-powerview.svg)](https://www.npmjs.com/package/homebridge-powerview)

This is a plugin for [Homebridge](https://github.com/nfarina/homebridge) to provide [HomeKit](https://www.apple.com/uk/ios/home/) support for [Hunter Douglas PowerView](https://www.hunterdouglas.com/operating-systems/motorized/powerview-motorization) window shades.

You can download it from [npm](https://www.npmjs.com/package/homebridge-powerview).

Supports:

 * Roller Shades.
 * Silhouette Shades with Vanes. The main accessory controls the vertical movement of the shades, and a slider under Details controls the tilt of the vanes. They can be controlled independently or combined using HomeKit scenes.
 * Duette Top-Down/Bottom-Up Shades. You will get two accessories, one for the bottom of the shade, and one of the top. They can be controlled independently or combined using HomeKit scenes,

## Installation

1. Install and setup [Homebridge](https://github.com/nfarina/homebridge).

2. Install this plugin:
```
npm install -g homebridge-powerview
```
3. Add the `PowerView` Platform to your Homebridge `config.json`:

```
    "platforms" : [
        {   
            "platform" : "PowerView"
        }
    ]
```

## Configuration

Just specifying the platform should work for more people, the hub will be found using the default `powerview-hub.local` mDNS hostname.

### Hostname or IP

If your PowerView hub is configured with a different default hostname, you can specify that, or the hub's IP address, by adding a `host` key to the platform configuration:

```
"host" : "192.168.1.1"
```

### Shade Types

The plugin uses the information from the PowerView hub to determine the types of shades, however it doesn't yet know all of the possible values. You may see the following warning in your log:

```
*** Shade 12345 has unknown type 99, assuming roller ***
```

If you see this, first please file an issue and provide details about the kind of shade that this is, so I can correctly recognize it in future versions.

You can then add a `forceRollerShades`, `forceSilhouetteShades`, or `forceDuetteShades` key to your `config.json` to force shades to be a certain type, e.g.:

```
"forceDuetteShades": [ 12345, 99999 ]
```