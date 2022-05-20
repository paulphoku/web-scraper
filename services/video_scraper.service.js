const fs = require('fs');
const ytdl = require('ytdl-core');

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

            return {
                videoID: videoID,
                audioFormats: audioFormats,
                info: info
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
      * @param quality video quality :tiny, small, high , highest e.c.t
      * @param format video format : mp4, webm, e.c.t
      */
    download: async function (_url, quality, format, title) {
        let videoID = ytdl.getURLVideoID(_url);
        let filename = `${title}.${format}`;

        try {
            ytdl(_url, {
                quality: quality,
                filter: format => format.container === format
            }).pipe(fs.createWriteStream(`public/downloads/${filename}`));
            return filename = filename;
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