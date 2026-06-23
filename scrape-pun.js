const fs = require('fs');
const ftp = require('basic-ftp');
const { XMLParser } = require('fast-xml-parser');

const BASE_URL = process.env.SGR_BASE_URL || 'https://api.energyportal.sgrlucegas.com/services';
const USERNAME = process.env.SGR_USERNAME;
const PASSWORD = process.env.SGR_PASSWORD;

const FTP_HOST = process.env.FTP_HOST;
const FTP_USER = process.env.FTP_USER;
const FTP_PASSWORD = process.env.FTP_PASSWORD;
const FTP_REMOTE_PATH =
  process.env.FTP_REMOTE_PATH || '/public_html/connextus-pun-orario/pun-latest.json';

const parser = new XMLParser({ ignoreAttributes: false });

function getYesterdayDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return text;
}

async function createSession() {
  const xml = await request(`${BASE_URL}/rest/portalapi/Core/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      createNewSessionRequest: {
        company: 'SGR',
        locale: 'it',
      },
    }),
  });

  const data = parser.parse(xml);
  const sessionId = data?.createNewSessionResponse?.session?.id;

  if (!sessionId) {
    throw new Error('Could not read sessionId');
  }

  return sessionId;
}

async function login(sessionId) {
  await request(`${BASE_URL}/rest/portalapi/Core/v1/user/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      sessionId,
    },
    body: JSON.stringify({
      doLoginRequest: {
        username: USERNAME,
        password: PASSWORD,
      },
    }),
  });
}

async function fetchPun(date, sessionId) {
  const url =
    `${BASE_URL}/rest/portalapi/Erp/v1/quotations` +
    `?detailLevel=Day` +
    `&startDate=${date}` +
    `&endDate=${date}` +
    `&quotationType=PUN`;

  const xml = await request(url, {
    method: 'GET',
    headers: { sessionId },
  });

  const data = parser.parse(xml);
  const quotation = data?.findQuotationsResponse?.quotations?.quotation;

  if (!quotation) {
    throw new Error('Could not read quotation');
  }

  const details = Array.isArray(quotation.details?.det)
    ? quotation.details.det
    : [quotation.details?.det].filter(Boolean);

  return {
    date,
    source: 'SGR',
    market: 'PUN',
    unit: 'EUR/MWh',
    valueMono: Number(quotation.valueMono),
    min: Number(quotation.valueMonoMin),
    max: Number(quotation.valueMonoMax),
    hours: details.map((det) => ({
      hour: Number(det.hour),
      value: Number(det.val),
      frameCode: det.frameCode,
      frameCodeBio: det.frameCodeBio,
    })),
    updatedAt: new Date().toISOString(),
  };
}

async function uploadToWebsite(localFile) {
  if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) {
    console.log('FTP secrets missing. Skipping website upload.');
    return;
  }

  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASSWORD,
      secure: false,
    });

    await client.uploadFrom(localFile, FTP_REMOTE_PATH);
    console.log(`Uploaded to ${FTP_REMOTE_PATH}`);
  } finally {
    client.close();
  }
}

async function main() {
  if (!USERNAME || !PASSWORD) {
    throw new Error('Missing SGR_USERNAME or SGR_PASSWORD');
  }

  const date = process.env.PUN_DATE || getYesterdayDate();

  console.log(`Fetching SGR PUN for ${date}`);

  const sessionId = await createSession();
  console.log('Session created');

  await login(sessionId);
  console.log('Login successful');

  const punData = await fetchPun(date, sessionId);

  fs.writeFileSync('pun.json', JSON.stringify(punData, null, 2));

  console.log('pun.json updated');
  console.log(JSON.stringify(punData, null, 2));

  await uploadToWebsite('pun.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
