'use strict';

import { RegExpParts } from "./RegExpParts";
import { TimestampFormatParser, TimestampMatch } from "./TimestampParser";

const MONTH_MAP: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

/**
 * Example: 01-Jun-2026 10:27:35.214
 */
export class TomcatDateTimeFormatParser implements TimestampFormatParser {
    private pattern = new RegExp(
        `(\\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\\d{4})` +
        `(${RegExpParts.DateTimeSeparator}(${RegExpParts.Time}))`,
        'i'
    );

    parse(text: string): TimestampMatch | null {
        const match = this.pattern.exec(text);
        if (match) {
            const month = MONTH_MAP[match[2].toLowerCase()];
            const normalized = `${match[3]}-${month}-${match[1]} ${match[6] || ''}`.replace(',', '.').trim();
            return {
                match: match,
                normalizedTimestamp: normalized,
                containsDate: true
            } as TimestampMatch;
        }
        return null;
    }
}
