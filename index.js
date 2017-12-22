var Player = require('./lib/player');
var downloader = require('./lib/downloader');
var async = require("async")
var Service, Characteristic;

module.exports = function(homebridge) {
    
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    HomebridgeAPI = homebridge;
    homebridge.registerPlatform('homebridge-omxplayer', 'OmxPlayer', OmxPlayer);
}

function OmxPlayer(log, config) {
    console.log('OmxPlayer plugin started!');
    this.log = log;
    this.name = config.name;
    this.playPlaylistSwitch = config.playPlaylistSwitch || true;
    this.shuffleSwitch = config.shuffleSwitch || false;
    this.repeatAll = config.repeatAll || false;
    this.playNextSwitch = config.playNextSwitch || true;
    this.volumeControl = config.volumeControl || true;
    this.playlist = config.playlist || [];
    this.path = config.path || HomebridgeAPI.user.persistPath()
    this.playingShuffle = false;
    this.playingPlaylist = false;
    this.playingIndividual = false;
    this.player = null;
    this.volume = this.volumeControl ? 50 : 100;
    this.trackAccessories = []
    this.nextRequest = false;
}

OmxPlayer.prototype.accessories = function(callback) {
    var myAccessories = []
    for (i=0;i<this.playlist.length;i++){
        var track = {
            name: this.playlist[i].switchName,
            youtube: this.playlist[i].youtube,
            filename: this.playlist[i].filename,
            loop: this.playlist[i].loop || true
        }
        var accessory = new trackAccessory(this.log, track, this);
        myAccessories.push(accessory);
        self.trackAccessories.push(accessory);
        this.log('Created New Track Accessory: "' + track.name + '"');
    }

    if (this.playPlaylistSwitch) {
        var accessory = new playPlaylistAccessory(this.log, this);
        myAccessories.push(accessory);
        this.log('Created New Play Playlist Accessory: "Play ' + this.name + '"');
    }

    if (this.shuffleSwitch) {
        var accessory = new shuffleAccessory(this.log, this);
        myAccessories.push(accessory);
        this.log('Created New Shuffle Accessory: "Shuffle ' + this.name + '"');
    }

    if (this.playNextSwitch) {
        var accessory = new playNextAccessory(this.log, this);
        myAccessories.push(accessory);
        this.log('Created New Play Next Accessory: "PlayNext ' + this.name + '"');
    }

    if (this.volumeControl) {
        var accessory = new volumeAccessory(this.log, this);
        myAccessories.push(accessory);
        this.log('Created New Volume Control Accessory: "Volume ' + this.name + '"');
    }
    callback(myAccessories);
}


function trackAccessory(log, config, platform) {
    this.log = log;
    this.name = config.name;
    this.youtube = config.youtube;
    this.filename = config.filename;
    this.loop = config.loop;
    this.path = platform.path

    if (this.youtube) {   
        this.log('Youtube url found in config, downloading...');
        var self = this;
        downloader.download(this.youtube, this.path, this.log, function (err, filename) {
            this.filename = filename;
            self.log('Finished Download: ' + filename);
        });
    }

}

trackAccessory.prototype = {
    getServices: function(){
        this._service = new Service.Switch(this.name);
        this._service.getCharacteristic(Characteristic.On)
            .on('set', this.setOn.bind(this));

        var informationService = new Service.AccessoryInformation();
            informationService
                .setCharacteristic(Characteristic.Manufacturer, 'OMX Player')
                .setCharacteristic(Characteristic.Model, "track-"+this.name)
            
        return [this._service, informationService];
    },
    
    setOn: function(on, callback){
        if (on) {
            if (platform.player){
                this.log('Switching Track to ' + this.name );
                platform.player.newSource(this.filename, this.loop, self.log, platform.volume);

            } else {
                this.log('Playing ' + this.name );
                platform.player = new Player(this.filename, this.loop, self.log, platform.volume);
            }
            callback();

            platform.player.waitForClose(function(){
                // self.log(self.name + ' Stopped!');
                self._service.getCharacteristic(Characteristic.On).updateValue(false)
            })

        } else {
            if (platform.player) {
                platform.player.quit();
                platform.player = null;
            } else {
                this.log('Player is already closed');
            }
            callback();
        }
    }
}



function playPlaylistAccessory(log, platform) {
    this.log = log;
    this.name = "Play " + platform.name
    this.playlist = platform.trackAccessories;
    this.loop = false;
    this.repeatAll = platform.repeatAll;
    this.keepPlaying = this.repeatAll

}   


playPlaylistAccessory.prototype = {
    getServices: function(){
        this._service = new Service.Switch(this.name);
        this._service.getCharacteristic(Characteristic.On)
            .on('set', this.setOn.bind(this));

        var informationService = new Service.AccessoryInformation();
            informationService
                .setCharacteristic(Characteristic.Manufacturer, 'OMX Player')
                .setCharacteristic(Characteristic.Model, "Play Playlist-"+platform.name)
            
        return [this._service, informationService];
    },
    
    setOn: function(on, callback){
        var self = this;
        if (on) {
            this.keepPlaying = this.repeatAll
            callback();

            self.log('Playing Playlist - ' + platform.name);

            function playIt(){
                async.eachOfSeries(self.playlist, function (track, index, next) {
                    if (platform.player == null){
                        self.log('Playing ' + track.name );
                        platform.player.newSource(track.filename, self.loop, self.log, platform.volume);
        
                    } else {
                        self.log('Playing ' + track.name );
                        platform.player = new Player(track.filename, self.loop, self.log, platform.volume);
                    }

                    var closed = false;
                    var nextInterval = setInterval(function(){
                        if (platform.nextRequest){
                            clearInterval(nextInterval)
                            platform.nextRequest = false
                            next();
                        } else if (closed){
                            clearInterval(nextInterval)
                            self.log(self.playlist[shuffledIndex].name + ' Stopped!');
                            next();
                        }
                    },2000)

                    platform.player.waitForClose(function(){
                        closed = true;
                    })

                }, function (err) {
                    if (self.keepPlaying){
                        self.log('Playing Playlist Again...' );
                        playIt()
                    } else {
                        self.log('Playlist is over...');
                        self._service.getCharacteristic(Characteristic.On).updateValue(false)
                        return;
                    }
                });
            }
            playIt()

        } else {
            this.keepPlaying = false
            if (platform.player) {
                platform.player.quit();
                platform.player = null;
            } else {
                this.log('Player is already closed');
            }
            callback();
        }
    }
}


function shuffleAccessory(log, platform) {
    this.log = log;
    this.name = "Shuffle " + platform.name
    this.playlist = platform.trackAccessories;
    this.loop = false;
    this.repeatAll = platform.repeatAll;
    this.keepPlaying = this.repeatAll

}   


shuffleAccessory.prototype = {
    getServices: function(){
        this._service = new Service.Switch(this.name);
        this._service.getCharacteristic(Characteristic.On)
            .on('set', this.setOn.bind(this));

        var informationService = new Service.AccessoryInformation();
            informationService
                .setCharacteristic(Characteristic.Manufacturer, 'OMX Player')
                .setCharacteristic(Characteristic.Model, "Play Shuffle-"+platform.name)
            
        return [this._service, informationService];
    },
    
    setOn: function(on, callback){
        var self = this;
        if (on) {
            this.keepPlaying = this.repeatAll
            callback();

            self.log('Playing Playlist Shuffled - ' + platform.name);

            function playIt(){
                async.eachOfSeries(self.playlist, function (track, index, next) {
                    var shuffledIndex = Math.floor(Math.random() * self.playlist.length);
                    if (platform.player == null){
                        self.log('Playing ' + self.playlist[shuffledIndex].name );
                        platform.player.newSource(self.playlist[shuffledIndex].filename, self.loop, self.log, platform.volume);
        
                    } else {
                        self.log('Playing ' + track.name );
                        platform.player = new Player(self.playlist[shuffledIndex].filename, self.loop, self.log, platform.volume);
                    }
                    
                    var closed = false;
                    var nextInterval = setInterval(function(){
                        if (platform.nextRequest){
                            clearInterval(nextInterval)
                            platform.nextRequest = false
                            next();
                        } else if (closed){
                            clearInterval(nextInterval)
                            self.log(self.playlist[shuffledIndex].name + ' Stopped!');
                            next();
                        }
                    },2000)

                    platform.player.waitForClose(function(){
                        closed = true;
                    })


                }, function (err) {
                    if (self.keepPlaying){
                        self.log('Playing Playlist Shuffled Again...' );
                        playIt()
                    } else {
                        self.log('Playlist is over...');
                        self._service.getCharacteristic(Characteristic.On).updateValue(false)
                        return;
                    }
                });
            }
            playIt()

        } else {
            this.keepPlaying = false
            if (platform.player) {
                platform.player.quit();
                platform.player = null;
            } else {
                this.log('Player is already closed');
            }
            callback();
        }
    }
}



function playNextAccessory(log, platform) {
    this.log = log;
    this.name = "PlayNext " + platform.name;

}   


playNextAccessory.prototype = {
    getServices: function(){
        this._service = new Service.Switch(this.name);
        this._service.getCharacteristic(Characteristic.On)
            .on('set', this.setOn.bind(this));

        var informationService = new Service.AccessoryInformation();
            informationService
                .setCharacteristic(Characteristic.Manufacturer, 'OMX Player')
                .setCharacteristic(Characteristic.Model, "Play Next-"+platform.name)
            
        return [this._service, informationService];
    },
    
    setOn: function(on, callback){
        var self = this;
        if (on) {
            console.log("Next Song Requested")
            this.nextRequest = true;
            callback();
            setTimeout(function(){
                self._service.getCharacteristic(Characteristic.On).updateValue(false)
            }, 2000)
        }
    }
}



function volumeAccessory(log, platform) {
    this.log = log;
    this.name = "Volume " + platform.name;
    this.volumeBeforeMute = 100;

}

volumeAccessory.prototype = {
    getServices: function(){
        this._service = new Service.Lightbulb(this.name);
        this._service
            .getCharacteristic(Characteristic.On)
            .on('set', this.setMuteState.bind(this));
        
        this._service
            .addCharacteristic(new Characteristic.Brightness())
            .on('set', this.setVolume.bind(this));

        var informationService = new Service.AccessoryInformation();
            informationService
                .setCharacteristic(Characteristic.Manufacturer, 'OMX Player')
                .setCharacteristic(Characteristic.Model, this.name)
            
        return [this._service, informationService];
    },
    
    setMuteState: function(on, callback){
        if (on) {
            this.log('Disable Mute on Player...');
            if (platform.player) platform.player.setVolume(this.volumeBeforeMute, platfrom.volume);
            else this.log('Nothing is playing, But setting anyway');
            platfrom.volume = this.volumeBeforeMute
        } else {
            this.log('Setting Player to Mute...');
            if (platform.player) platform.player.setVolume(0, platfrom.volume);
            else this.log('Nothing is playing, But setting anyway');
            platfrom.volume = 0
        }
        callback();
    },

    setVolume: function(state, callback){
        this.log('Setting Volume to ' + state);
        if (platform.player) platform.player.setVolume(state, platfrom.volume);
        else this.log('Nothing is playing, But setting anyway');
        platfrom.volume = state 
        if (state !== 0) this.volumeBeforeMute = state 
        callback();
    }
}