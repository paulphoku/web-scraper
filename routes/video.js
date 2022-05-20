var express = require('express');
var router = express.Router();
var video_scraper = require('../services/video_scraper.service');

router.get('/', async function (req, res, next) {

    let _url = req.query._url;
    let url = await video_scraper.url.validate(_url);
    let data = await video_scraper.youtube.get_info(_url);

    switch (url.type) {
        case 'yt':
            res.send(
                { status: 0, url: url.url, embeded_url: url.embeded_url, data: data, msg: 'done' }
            );
            break;
        default:
            res.send({ status: 1, msg: url_type })
            break;
    }
});

router.get('/download', async function (req, res, next) {

    let _url = req.query._url;
    let quality = req.query.quality;
    let format = req.query.format;
    let title = req.query.title;
    let browser_id = req.query.browser_id;

    let url = await video_scraper.url.validate(_url);
    var file = '';

    switch (url.type) {
        case 'yt':
            file = await video_scraper.youtube.download(_url, quality, format, title, browser_id);
            file == false ?
                res.send(
                    { status: 1, msg: 'something went wrong' }
                ) :
                // res.send(
                //     { status: 0, file: file }
                // )
                res.download(`${file}`);
            break;
        default:
            res.send({ status: 1, msg: url_type })
            break;
    }
});

module.exports = router;
