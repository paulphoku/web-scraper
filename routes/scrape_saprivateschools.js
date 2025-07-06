const express = require("express");
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const Data = require('../saprivateschool.json');
const fs = require('fs');

async function getLinksFromPage(url, startingWithUrl) {
    try {
        // Fetch the HTML content from the URL
        const response = await axios.get(url);

        // Load the HTML into cheerio
        const $ = cheerio.load(response.data);

        // Find all the <a> tags and filter the ones that start with the specified URL
        const links = [];
        $('a').each((index, element) => {
            const href = $(element).attr('href');

            // Check if the link exists and starts with the given URL prefix
            if (href && href.startsWith(startingWithUrl)) {
                links.push(href);
            }
        });

        // Return the list of filtered links
        // return links;
        return response.data
    } catch (error) {
        console.error(`Error fetching or parsing the page: ${error.message}`);
        return [];
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Convert JSON Array to CSV format
function jsonToCsv(jsonArray) {
    if (!jsonArray || jsonArray.length === 0) return ''; // Return empty string for empty array

    // Extract the headers (keys from the first object)
    const headers = Object.keys(jsonArray[0]);

    // Map the JSON array to rows, where each row is a comma-separated string of values
    const rows = jsonArray.map(obj => {
        return headers.map(header => {
            // Ensure that the value is properly escaped (in case there are commas, newlines, or quotes)
            let value = obj[header] !== undefined ? obj[header] : '';
            value = value.toString().replace(/"/g, '""'); // Escape double quotes
            if (value.includes(',') || value.includes('\n') || value.includes('"')) {
                value = `"${value}"`; // Enclose in double quotes if necessary
            }
            return value;
        }).join(',');
    });

    // Combine headers and rows into a single CSV string
    const csv = [headers.join(','), ...rows].join('\n');

    return csv;
}

// Function to save CSV to a file
function saveCsvToFile(csvData, filename) {
    fs.writeFileSync(filename, csvData, 'utf8'); // Synchronously write to a file
    console.log(`CSV file saved as ${filename}`);
}

async function getLinks(startingWithUrl, html) {
    try {

        // Load the HTML into cheerio
        const $ = cheerio.load(html);

        // Find all the <a> tags and filter the ones that start with the specified URL
        const links = [];
        $('a').each((index, element) => {
            const href = $(element).attr('href');

            // Check if the link exists and starts with the given URL prefix
            if (href && href.startsWith(startingWithUrl)) {
                links.push(href);
            }
        });

        // Return the list of filtered links
        return links;
    } catch (error) {
        console.error(`Error fetching or parsing the page: ${error.message}`);
        return [];
    }
}

async function getSchools() {
    let page = 0;
    numPages = 24;
    let Links = [];
    for (let index = 0; index < Data.length; index++) {
        const links = await getLinks(`https://saprivateschools.co.za/listing/`, Data[index].html);
        Links.push(links);
    }
    return Links;
};

async function getSchoolsDetails(url) {
    try {
        // Fetch the HTML content from the URL
        const response = await axios.get(url);

        // Load the HTML into cheerio
        const $ = cheerio.load(response.data);


        // Array to store all category names
        const Location = [];
        const Contact = [];
        const Grade = [];

        // Select all <span> elements with the class "category-name" and extract their text
        $('span.category-name').each((index, element) => {
            // Push each category name to the array after trimming whitespace
            Location.push($(element).text().trim());
        });

        // Select all <span> elements with the class "wp-editor-content" and extract their text
        $('span.wp-editor-content').each((index, element) => {
            // Push the text to the array, trimming any whitespace
            Contact.push($(element).text().trim());
        });

        // Select all <a> tags that have a <span> child element, then extract the text from <span>
        $('a span').each((index, element) => {
            // Push the text inside each <span> tag to the array, trimming any whitespace
            Grade.push($(element).text().trim());
        });

        // Select the <span> inside <div class="timing-today"> and extract its text
        const openingHours = $('div.timing-today span').first().text().trim();

        // Select the <p> inside the <div class="pf-body"> and extract its text
        const paragraphText = $('div.pf-body p').text().trim();

        // Select the <div class="value"> and extract its text
        const address = $('div.value').text().trim();

        return {
            Province: Location[0],
            Town: Location[1],
            Email: Contact[0],
            Phone: Contact[1],
            Website: Contact[2],
            Website1: url,
            Gender: Grade[13],
            Language: Grade[14],
            Curriculum: Grade[15],
            GradeMin: Grade[20],
            GradeMax: Grade[21],
            OpeningHours: openingHours,
            Description: paragraphText,
            Address: address
        };
    } catch (error) {
        console.error(`Error fetching or parsing the page: ${error.message}`);
        return [];
    }
}

router.get("/", async function (req, res) {
    try {
        let schoolLinks = await getSchools();
        let SchoolList = [];

        for (let x = 0; x < schoolLinks.length; x++) {
            let school = [];
            for (let y = 0; y < schoolLinks[x].length; y++) {
                const el = await getSchoolsDetails(schoolLinks[x][y]);
                SchoolList.push(el);
                school.push(el)
                // await delay(1000);  // Wait for 1 second
                console.log(`page : ${x} , item ${y} of ${schoolLinks[x].length}`);
            }

            // Convert JSON to CSV
            const csvData = jsonToCsv(school);

            // Save the CSV data to a file
            saveCsvToFile(csvData, `./public/downloads/SchoolList-page-${x}.csv`);
        }


        // Convert JSON to CSV
        const csvData = jsonToCsv(SchoolList);

        // Save the CSV data to a file
        saveCsvToFile(csvData, './public/downloads/SchoolList.csv');

        res.send({
            status: 0,
            msg: 'done',
            // schoolLinks: schoolLinks,
            SchoolList: SchoolList
        });
    } catch (err) {
        console.log('err:');
        res.send({
            'err:': err,
            'status': 0,
        });
    }
});

module.exports = router;
