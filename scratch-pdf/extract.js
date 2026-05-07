const fs = require('fs');
const pdf = require('pdf-parse');

async function extractEvents(pdfPath) {
  let dataBuffer = fs.readFileSync(pdfPath);
  try {
    const data = await pdf(dataBuffer);
    const lines = data.text.split('\n');
    let output = `--- EVENTS IN ${pdfPath} ---\n`;
    let isEventSection = false;
    let sectionCount = 0;
    
    // We will look for keywords like "event", "alarm", "type", "vca", "iva", "ivs"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      
      // Keywords that might indicate an event list
      if (line.includes('alarm type') || line.includes('event type') || line.includes('vca') || line.includes('intelligent analysis') || line.includes('smd') || line.includes('motion detection') || line.includes('face') || line.includes('lpr')) {
         
         // extract context
         const start = Math.max(0, i - 2);
         const end = Math.min(lines.length - 1, i + 5);
         output += `\n[Match ${++sectionCount} around line ${i}]:\n`;
         for (let j = start; j <= end; j++) {
            output += lines[j] + '\n';
         }
      }
    }
    
    // Also try to find exact tables or lists if possible, but dumping matches is safer first
    fs.writeFileSync(pdfPath + '.events.txt', output);
    console.log(`Extracted to ${pdfPath}.events.txt`);
  } catch (error) {
    console.error(`Error processing ${pdfPath}:`, error);
  }
}

async function main() {
  await extractEvents('../vs373-api-documentation-en.pdf');
  await extractEvents('../vs373-user-guide-en.pdf');
}

main();
