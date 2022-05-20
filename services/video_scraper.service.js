var fs = require("fs");
const util = require('util');
const ytdl = require('ytdl-core');
const socket = require('./socket.service');

// node native promisify
const writeFile = util.promisify(fs.writeFile.bind(fs));

var url = {
    /**
      * 
      * validate url 
      * 
      * @param url url string
      */
    validate: async function (url) {
        if (url != undefined || url != '') {
            var yt_regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|\?v=)([^#\&\?]*).*/;
            if (url.match(yt_regExp) && url.match(yt_regExp)[2].length == 11) {
                // Do anything for being valid
                // if need to change the url to embed url then use below line
                let embeded_url = `//www.youtube.com/embed/${url.match(yt_regExp)[2]}`;
                return { type: 'yt', embeded_url: embeded_url, url: url };
            }
            else {
                // Do anything for not being valid
                return 'invalid link'
            }
        }
    }
}

async function write_file(filename, buffer) { await writeFile(filename, buffer) }

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

var youtube = {
    /**
      * 
      * get info about youtube video, quality format, bitrate , title e.c.t
      * 
      * @param _url url string
      */
    get_info: async function (_url) {
        try {
            let videoID = ytdl.getURLVideoID(_url);
            let info = await ytdl.getInfo(videoID);
            let audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
            let title = info.videoDetails.title;
            let videoFormats = ytdl.filterFormats(info.formats, 'video');

            return {
                videoID: videoID,
                audioFormats: audioFormats,
                videoFormats: videoFormats,
                title: title,
            }
        } catch (err) {
            console.log('err:', err)
            return 'Invalid link'
        }
    },

    /**
      * 
      * download video file from server
      * 
      * @param _url url string
      * @param _quality video quality :tiny, small, high , highest e.c.t
      * @param _format video format : mp4, webm, e.c.t
      * @param _title video title 
      * @param _browser_id browser id : uuid
      */
    download: async function (_url, _quality, _format, _title, _browser_id) {

        try {
            // logger.info(`Downloading from ${url} ...`);
            console.log(`Downloading from ${_url} ...`);
            let filename = `public/downloads/${_title}.${_format}`;
            var perc;
            var total;
            var downloaded;
            var perc;

            return new Promise((resolve, reject) => {
                const stream = ytdl(_url, {
                    quality: _quality,
                    filter: (format) => format.container === _format,
                })

                stream.pipe(fs.createWriteStream(filename));
                stream.on("progress", function (_chunk, _downloaded, _total) {
                    perc = formatBytes(_downloaded) == formatBytes(_total) ? 100 : Number((_downloaded / _total) * 100).toFixed(0);
                    console.log(`Downloading : ${perc} %`)
                    total = formatBytes(_total);
                    downloaded = formatBytes(_downloaded);

                    //notity
                    socket.broadcast.user(_browser_id, 'download_progress', {
                        perc: perc,
                    })
                })
                stream.on("finish", function () {
                    perc = 100;
                    console.log(`Downloading : ${perc} %`)
                    console.log("Finished!");

                    //notity
                    socket.broadcast.user(_browser_id, 'download_progress', {
                        perc: perc,
                    })

                    resolve(filename)
                });






            });
        } catch (err) {
            console.log('error:', err)
            return false;
        }
    }
}

module.exports = ({
    url: url,
    youtube: youtube
})