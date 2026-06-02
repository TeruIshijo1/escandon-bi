const fs = require('fs');
const code = fs.readFileSync('D:/Escritorio/escandon-bi/backend/services/rag.service.js', 'utf8');
let s = [];
let i = 0;
while(i < code.length) {
    if(code.substr(i,2) === '/*') { i = code.indexOf('*/', i)+2; continue; }
    if(code.substr(i,2) === '//') { i = code.indexOf('\n', i)+1; continue; }
    if(code[i] === '\'' || code[i] === '\"' || code[i] === '\`') {
        let quote = code[i];
        i++;
        while(i < code.length && code[i] !== quote) {
            if(code[i] === '\\') i++;
            i++;
        }
        i++;
        continue;
    }
    if(code[i] === '{') s.push(code.substring(0, i).split('\n').length);
    if(code[i] === '}') s.pop();
    i++;
}
console.log('Unmatched opens at lines:', s);
