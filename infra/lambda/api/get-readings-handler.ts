import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { badRequest, json } from './common';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Without a range: the newest `limit` readings, at most this many. */
export const MAX_LATEST_ROWS = 500;
/** With a range: at most this many readings (24 h at one a minute is 1440). */
export const MAX_RANGE_ROWS = 2000;
/** Rows asked of DynamoDB per page of a range query. */
const PAGE_ROWS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `GET /readings?limit=N` returns the newest N readings (default 100, at most 500).
 * `GET /readings?from=…&to=…` (ISO-8601, either may be left out: `to` defaults to now and `from` to
 * 24 h before `to`) returns the readings in that range, newest first, at most 2000 (or `limit`).
 * Either way the response is `{"readings": [...]}`.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const tableName = process.env.READINGS_TABLE_NAME!;
  const params = event.queryStringParameters ?? {};
  const parsedLimit = params.limit ? parseInt(params.limit, 10) : Number.NaN;
  const limitParam = parsedLimit > 0 ? parsedLimit : undefined;

  if (!params.from && !params.to) {
    const limit = Math.min(limitParam ?? 100, MAX_LATEST_ROWS);
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'locationId = :loc',
        ExpressionAttributeValues: { ':loc': 'pi' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return json(200, { readings: result.Items ?? [] });
  }

  const to = params.to ? new Date(params.to) : new Date();
  const from = params.from ? new Date(params.from) : new Date(to.getTime() - DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return badRequest('Invalid date format. Use ISO-8601 format.');
  }
  if (from > to) return badRequest('from must not be after to');

  const max = Math.min(limitParam ?? MAX_RANGE_ROWS, MAX_RANGE_ROWS);
  const readings: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'locationId = :loc AND #ts BETWEEN :from AND :to',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':loc': 'pi',
          ':from': from.toISOString(),
          ':to': to.toISOString(),
        },
        ScanIndexForward: false,
        Limit: Math.min(PAGE_ROWS, max - readings.length),
        ExclusiveStartKey: startKey,
      }),
    );
    readings.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey && readings.length < max);

  return json(200, { readings: readings.slice(0, max) });
};
