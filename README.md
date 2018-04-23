# homebridge-powerview
Homebridge plugin for Hunter Douglas PowerView shades.

## Installation

1. Install and setup [Homebridge](https://github.com/nfarina/homebridge).

2. Install this plugin directly from git:
```
npm install -g keybuk/homebridge-powerview
```
3. Add the `PowerView` Platform to your Homebridge `config.json`:

```
    "platforms" : [
        {   
            "platform" : "PowerView"
        }
    ]
```

This should work for most people, but if your PowerView hub is configured with a different default hostname, you can specify that, or the hub's IP address, by adding a `host` key to the platform configuration:

```
"host" : "192.168.1.1"
```