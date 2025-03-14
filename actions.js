const puppeteer = require("puppeteer");

const fs = require("node:fs/promises");
const { sha256 } = require("hash.js");

function slugify(value) {
  return value
    .toString()
    .replaceAll(/[^a-zA-Z0-9_-]+/g, "-")
    .replaceAll(/^[-]+/g, "")
    .replaceAll(/[-]+$/g, "");
}
function timestampedFilenameForUrl(
  targetUrl,
  headers,
) {
  const url = new URL(targetUrl.toString());
  let hasher = sha256().update(url.toString());
  if (headers) {
    hasher = hasher.update(JSON.stringify(headers));
  }
  const hash = hasher.digest("hex");
  const now = new Date();
  const timestamp = now.getTime();
  return slugify(`${url.origin}-${hash}-${timestamp}`);
}

async function serializeRequest(request) {
  const url = request.url();
  const requestUrl = new URL(url);

  const method = request.method();
  const headers = request.headers();
  const postData = (() => {
    const data = request.postData();
    try {
      return JSON.parse(data);
    } catch(_) {
      return data
    }
  })();
  const data = {
    url,
    method,
    headers,
    postData,
  };
  if (/www.academia.edu/.exec(requestUrl.origin) && /\/v0\/arbitrary_event/.exec(requestUrl.pathname)) {
    console.log(data);
  }
  return data
}

  async function logRequest(
    targetArticleUrl,
    request,
  ) {
  const articleUrl = new URL(targetArticleUrl.toString());
  const mentionId = articleUrl.searchParams.get("mention_id");
  const url = request.url();
  const filenamePrefix = timestampedFilenameForUrl(url, request.headers());
  console.log(`logging request for ${url}`);
  const requestDumpFilename = `logs/mention-id-${mentionId}-${filenamePrefix}.request.json`;
  let jsonRequest = null;
  try {
    jsonRequest = JSON.stringify(await serializeRequest(request), null, 2);
  } catch (e) {
    console.error(`error logging request for ${url}: ${e}`);
    return;
  }
  const fd = await fs.open(requestDumpFilename, "w");
  await fd.write(jsonRequest);
  await fd.close();
}

async function serializeResponse(response) {
  const url = response.url();
  const status = response.status();
  const content = await (async () => {
  try {
    return await response.content();
  } catch (e) {
    return new Uint8Array()
  }})();
  const headers = response.headers();
  return {
    url,
    content,
    headers,
    status,
  };
}

async function logResponse(
  targetArticleUrl,
  response,
) {
  const headers = response.headers();
  if (!/^(application\/text)/.exec(headers["Content-Type"])) {
    return
  }
  const articleUrl = new URL(targetArticleUrl);
  /* if (!/academia/.exec(articleUrl.origin)) {
   *   return
   * } */
  const mentionId = articleUrl.searchParams.get("mention_id");
  const url = response.url();
  const filenamePrefix = timestampedFilenameForUrl(url, headers);
  console.log(`logging response for ${url}`);
  const responseDumpFilename = `logs/mention-id-${mentionId}-${filenamePrefix}.response.json`;
  let jsonResponse = null;
  try {
    jsonResponse = JSON.stringify(await serializeResponse(response), null, 2);
  } catch (e) {
    console.error(`error logging response for ${url}: ${e}`);
    return;
  }
  const fd = await fs.open(responseDumpFilename, "w");
  await fd.write(jsonResponse);
  await fd.close();
}
async function reportMentionToDuplicateName(
  request,
) {
  const url = new URL(request.url());
  if (url.origin !== "https://www.academia.edu") {
    return false;
  }
  if (url.pathname !== "/v0/arbitrary_event") {
    return false;
  }
  if (request.hasPostData() === false) {
    return false;
  }
  const postData = await request.fetchPostData();
  if (typeof postData !== "string") {
    return false;
  }
  const body = JSON.parse(postData);
  if (body?.data?.question_id === "DuplicateName") {
    return true;
  }
  return false;
}
async function disclaim_academia_edu_article_authorship(url) {
  const articleUrl = new URL(url);
  const mentionId = articleUrl.searchParams.get("mention_id");

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  page.on("request", async (request) => {
    await logRequest(url, request);
  });

  page.on("response", async (response) => {
    await logResponse(url, response);
  });

  await page.setViewport({ width: 1080, height: 1024 });
  await page.goto(url.toString(), {
    waitUntil: "networkidle2",
  });

  const filenamePrefix = timestampedFilenameForUrl(url);

  let tick = await page.locator('input[name="DuplicateName"]');
  await tick.click();

  const ensureInputTicked = await page
    .locator('input[name="DuplicateName"]')
    .waitHandle();
  await ensureInputTicked?.evaluate((el) => {
    el.checked = true;
  });
  await page.screenshot({
    path: `screenshots/report-mention-to-wrong-human-${mentionId}-${filenamePrefix}-reason-to-disclaim.png`,
  });
  const button = await page.waitForSelector("text/Submit");
  await button.click();
  await page.screenshot({
    path: `screenshots/report-mention-to-wrong-human-${mentionId}-${filenamePrefix}-disclaim-reported.png`,
  });

  await browser.close();
}

async function main() {
  const disclaimLinks = JSON.parse(
    Array.from(await fs.readFile("./disclaim-links.json"))
         .map((c) => String.fromCharCode(c))
      .join(""),
  );

  await fs.mkdir("logs", { recursive: true });
  await fs.mkdir("screenshots", { recursive: true });

  for (const link of disclaimLinks) {
    await disclaim_academia_edu_article_authorship(link)
  }
}

main();
