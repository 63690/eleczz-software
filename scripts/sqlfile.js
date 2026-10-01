/* =========================================================
   Helpers for reading .sql files

   splitStatements(text)
     - understands  DELIMITER $$  ...  DELIMITER ;   (needed for
       stored procedures, whose bodies contain ';')
     - drops "-- comments" (but not a "--" inside a 'string')
     - skips empty statements
   ========================================================= */

function stripLineComment(line) {
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'") {
            if (inString && line[i + 1] === "'") { i++; continue; }   // '' inside a string
            inString = !inString;
        } else if (!inString && ch === "-" && line[i + 1] === "-" &&
                   (i + 2 >= line.length || /\s/.test(line[i + 2]))) {
            return line.slice(0, i);
        }
    }
    return line;
}

function splitStatements(text) {
    const statements = [];
    let delimiter = ";";
    let buffer = "";

    const flush = () => {
        const statement = buffer.trim();
        if (statement) statements.push(statement);
        buffer = "";
    };

    for (const rawLine of text.split(/\r?\n/)) {
        const line = stripLineComment(rawLine);
        const change = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(line);

        if (change) {
            flush();
            delimiter = change[1];
            continue;
        }

        buffer += line + "\n";

        if (buffer.trimEnd().endsWith(delimiter)) {
            buffer = buffer.trimEnd().slice(0, -delimiter.length);
            flush();
        }
    }

    flush();
    return statements;
}

/* The files start with CREATE DATABASE / USE for people who run them by hand
   in Workbench. setup-db uses DB_NAME from .env instead, so drop those. */
function withoutDatabaseSwitching(statements) {
    return statements.filter(s => !/^(USE|CREATE DATABASE)\b/i.test(s));
}

module.exports = { splitStatements, withoutDatabaseSwitching };
