import Common from "./common";
import CONFIG from "../config";
import Log from "./log";
import * as jsdom from 'jsdom';
import FileHandler from "./file";
import Epg from "./epg";
import {log} from "util";

const { JSDOM } = jsdom;

interface ChannelInterface {
    name : string,
    logoUrl : string,
    id : number,
    url : string | null,
    category: string
}

interface PlayerInterface {
    response : string,
    loaded : Date
}

interface ChannelCategoryDictionary {
    [categoryNumber: number] : string
}

function getCategoryMapping(categories : HTMLSelectElement) : ChannelCategoryDictionary {
    let categoryMapping : ChannelCategoryDictionary = {};
    if (!categories) {
        Log.write("Cannot fetch the channel categories!");
    }
    else {
        Log.write('Fetching channel categories...');
        for (var i = 0; i < categories.options.length; i++) {
            const category = categories.options[i];
            if (category.text === "Összes") {
                continue;
            }
            categoryMapping[Number(category.value)] = category.text;
        }
    }
    return categoryMapping;
}

class Digionline {
    private channelList : Array<ChannelInterface> = [];
    private lastHello : Date;
    private player : Array<PlayerInterface> = [];
    private channel : ChannelInterface | null;

    constructor(cb : () => void) {
        this.login(success => {
            if (success) {
                this.getChannelList(channelList => {
                    cb();
                    this.generateChannelList();
                    if (CONFIG.epg.needle) {
                        const epgEngine = new Epg();
                        epgEngine.setChannels(channelList);
                        epgEngine.generateEpg();
                    }
                });
            }
        });
        this.lastHello = new Date();
        this.channel = null;
    }

    private login(cb : (success : boolean) => void) : void {
        Log.write('Login digionline.hu');
        Common.request({
            uri: 'https://digionline.hu/login',
            method: 'GET'
        }, response => {
            const dom = new JSDOM(response);

            const tokenElem = dom.window.document.querySelector('[name="_token"]');
            if (tokenElem == null) {
                Log.error("Null _token! in response: ", response);
            }
            const token : string = tokenElem.value;

            Common.request({
                uri: 'https://digionline.hu/login',
                method: 'POST',
                formData: {
                    '_token': token,
                    email: CONFIG.login.email,
                    password: CONFIG.login.password,
                    accept: '1'
                }
            }, response => {
                this.checkLoggedIn(loggedIn => {
                    if (loggedIn) {
                        Log.write(`Logged in: ${CONFIG.login.email}`);
                    }
                    else {
                        Log.error(`Sikertelen belepes (helyes a felhasznalonev es jelszo?)`, '1');
                    }
                    cb(loggedIn);
                });
            });
        });
    }

    /**
     * cb-ben visszaadjuk be vagyunk-e már jelentkezve
     * @param loggedIn
     */
    public checkLoggedIn(loggedIn : (loggedIn : boolean) => void) : void {
        Common.request({
            uri: 'https://digionline.hu/',
            method: 'GET'
        }, response => {
            const dom = new JSDOM(response);
            if (dom.window.document.querySelector('.in-user')) {
                const loggedEmail = dom.window.document.querySelector('.in-user').textContent.trim();
                loggedIn(loggedEmail === CONFIG.login.email);
            }
            else {
                loggedIn(false);
            }
        });
    }

    public getChannelList(cb : (channelList : Array<ChannelInterface>) => void) : void {
        Log.write('Loading channel list...');
        Common.request({
            uri: 'https://digionline.hu/csatornak',
            method: 'GET'
        }, response => {
            const dom = new JSDOM(response);

            const categories = dom.window.document.getElementById("categories");
            const categoryMapping = getCategoryMapping(categories);

            dom.window.document.querySelectorAll('.channel').forEach(channelBox => {
                const name : string = channelBox.querySelector('.channels__name').textContent.trim();
                const logoUrl : string = channelBox.querySelector('img').src;
                const id : number = Number(channelBox.querySelector('.favorite').getAttribute('data-id'));
                const categoryNumber : number = Number(channelBox.getAttribute('data-category'));
                const category : string = ((categoryNumber in categoryMapping) ?
                    categoryMapping[categoryNumber] : String(categoryNumber));

                this.channelList.push({
                    name: name,
                    logoUrl: logoUrl,
                    id: id,
                    url: null,
                    category: category
                });
            });
            Log.write(`Channels loaded`, this.channelList.length);
            cb(this.channelList);
        });
    }

    private generateChannelList() : void {
        Log.write('Generating channel list...', '.m3u8');
        let simpleIPTVList = `#EXTM3U tvg-shift="${Common.getStaticTimeZoneOffset()}"\n`,
            tvheadendList = simpleIPTVList;


        this.channelList.forEach(channel => {
            const header = `#EXTINF:-${channel.id} tvg-id="id${channel.id}" tvg-name="${channel.name}" tvg-logo="${channel.logoUrl}" group-title="${channel.category}", ${channel.name} \n`,
                url = `http://${CONFIG.webconnect.domain}:${CONFIG.webconnect.port}/channel/${channel.id}.m3u8`;

            // for Simple IPTV plugin
            simpleIPTVList += header;
            simpleIPTVList += `${url}\n`;

            // for TVHeadend
            tvheadendList += header;
            tvheadendList += `pipe:///usr/bin/ffmpeg -i ${url} -c copy -f mpegts pipe:1\n`;
        });

        FileHandler.writeFile('channels_IPTV.m3u8', simpleIPTVList);
        FileHandler.writeFile('channels_tvheadend.m3u8', tvheadendList);
    }

    private getChannelById(id : number) : ChannelInterface {
        const cl = this.channelList;
        for (let i in cl) {
            if (cl[i].id === id) {
                return cl[i];
            }
        }

        Log.error(`channel (${id}) is not found`);
        throw new Error();
    }

    private getStampedChannel() : ChannelInterface {
        const timestamp = Math.floor(Date.now() / 1000);
        this.channel.url = `${this.channel.url.split('&_t=')[0]}&_t=${timestamp}`;
        return this.channel;
    }

    public getChannel(id, cb : (channel : ChannelInterface) => void) : void {
        if (this.channel && this.channel.id === id) {
            Log.write('Channel full cache', id, this.channel.name);
            cb(this.getStampedChannel());
            return;
        }

        const loadChannel = response => {
            if (response == null) {
                Log.write("Null response! Are we logged in?");
                this.hello(id);
                return;
            }
            
            const playlistBaseUrl = "https://online.digi.hu/api/streams/playlist/";
            let playlistSplit = response.split(playlistBaseUrl);
            if (playlistSplit.length < 2) {
                Log.write("Unexpected response! Are we logged in?");
                this.hello(id);
                return;
            }
            
            const playlistExtension = ".m3u8";
            let extensionSplit = playlistSplit[1].split(playlistExtension);
            if (extensionSplit.length < 2) {
                Log.error("Unexpected response", extensionSplit);
            }
            let playlistName = extensionSplit[0];

            const playlistUrl = `${playlistBaseUrl}${playlistName}${playlistExtension}`;

            Common.request({
                uri: playlistUrl,
                method: 'GET'
            }, playlistContent => {
                const streams : Array<string> = [];
                let videoStreamUrl = '';

                playlistContent.split('\n').forEach(row => {
                    if (row.substring(0, 5) === 'https') {
                        streams.push(row);
                        if (row.indexOf(`&q=${CONFIG.videoQuality}`) !== -1) {
                            videoStreamUrl = row;
                        }
                    }
                });

                const channel = this.getChannelById(id);
                channel.url = (videoStreamUrl || streams.pop());

                Common.request({
                    uri: channel.url,
                    method: 'GET'
                }, response => {
                    if (response.length < 10) {
                        searchChannel(streams, response => {
                            channel.url = response;
                            this.channel = channel;
                            cb(this.getStampedChannel());
                        });
                    }
                    else {
                        this.channel = channel;
                        cb(this.getStampedChannel());
                    }
                });
            });
        };

        function searchChannel(streams: Array<string>, cb: (response: string) => void) {
            if (!streams.length) {
                Log.error('Adashiba: a csatorna nem mukodik.');
                cb('');
                return;
            }
            const stream = streams.pop();

            Common.request({
                uri: stream,
                method: 'GET'
            }, response => {
                if (response.length > 10) {
                    cb(stream);
                }
                else {
                    Log.write(`Adashiba: nincs jel!`, Common.getUrlVars(stream)['q']);
                    searchChannel(streams, cb);
                }
            });
        }

        const channelKey = `id_${id}`;
        if (typeof this.player[channelKey] === 'undefined'
        || (typeof this.player[channelKey] !== 'undefined'
         && Common.diffTime(this.player[channelKey].loaded, new Date()) > 5)) {
            Common.request({
                uri: `https://digionline.hu/player/${id}`,
                method: 'GET'
            }, response => {
                loadChannel(response);
                this.player[channelKey] = {
                    loaded: new Date(),
                    response : response
                };
                Log.write('loaded from request', channelKey);
            });
        }
        else {
            Log.write(`loaded from cache`, channelKey);
            loadChannel(this.player[channelKey].response);
        }

    }

    /**
     * kapcsolat fenntartása (kössz a segítséget! :D)
     * @param id
     */
    public hello(id : number) : void {
        if (Common.diffTime(new Date(), this.lastHello) > 30) {
            Common.request({
                uri: `https://digionline.hu/refresh?id=${id}`,
                method: 'GET',
                headers: {
                    'Referer': `https://digionline.hu/player/${id}`,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            }, response => {
                const r = JSON.parse(response);
                Log.write(r);
                if (Object(r).error === true) {
                    this.login(() => {
                        this.channel = null;
                        Log.write('Logged in');
                    });
                }
                Log.write('Hello packet sent...', response);
            });
            this.lastHello = new Date();
        }
    }
}

export {Digionline, ChannelInterface, PlayerInterface};
