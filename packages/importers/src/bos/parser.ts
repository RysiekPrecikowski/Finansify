import {
  type Confidence,
  type ParsedStatement,
  type RawFile,
  type StatementParser,
} from '@finansify/core';

import { readBosRows } from './csv-rows';
import { makeExternalIdFactory } from './external-id';
import { BOS_HEADER, decodeBos } from './layout';
import { mapBosRow } from './map-operation';

function firstLine(text: string): string {
  const index = text.indexOf('\n');
  return (index === -1 ? text : text.slice(0, index)).trimEnd();
}

async function sniff(file: RawFile): Promise<Confidence> {
  try {
    const text = decodeBos(file.bytes);
    return firstLine(text) === BOS_HEADER ? 'certain' : 'none';
  } catch {
    return 'none';
  }
}

async function parse(file: RawFile): Promise<ParsedStatement> {
  const text = decodeBos(file.bytes);
  if (firstLine(text) !== BOS_HEADER) {
    throw new Error(
      `Unrecognized header — sniff() should have refused this file: "${firstLine(text)}"`,
    );
  }

  const rawRows = readBosRows(text);
  const externalIdFor = makeExternalIdFactory();
  const rows = rawRows
    .map((row) => mapBosRow(row, externalIdFor(row)))
    .filter((row) => row !== null);

  return { broker: bosStatementParser.broker, rows, warnings: [] };
}

export const bosStatementParser: StatementParser = {
  broker: 'bos',
  sniff,
  parse,
};
