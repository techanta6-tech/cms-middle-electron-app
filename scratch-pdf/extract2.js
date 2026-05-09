const fs = require('fs');
const PDFParser = require("pdf2json");

function parsePdf(filename) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser(this, 1);
        pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
        pdfParser.on("pdfParser_dataReady", pdfData => {
            const text = pdfParser.getRawTextContent();
            fs.writeFileSync(filename + ".txt", text);
            console.log("Saved " + filename + ".txt");
            resolve();
        });
        pdfParser.loadPDF("../" + filename);
    });
}

async function main() {
    await parsePdf("vs373-api-documentation-en.pdf");
    await parsePdf("vs373-user-guide-en.pdf");
}

main().catch(console.error);
