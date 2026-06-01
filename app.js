const state = {
  cars: [],
  champion: null,
  challenger: null,
  seenIds: new Set(),
  selectionHistory: [],
  round: 0,
  ended: false,
  timerStartedAt: null,
  elapsedMs: 0,
  timerId: null,
};

const els = {
  setupPanel: document.querySelector("#setupPanel"),
  gamePanel: document.querySelector("#gamePanel"),
  resultPanel: document.querySelector("#resultPanel"),
  fileInput: document.querySelector("#fileInput"),
  loadStatus: document.querySelector("#loadStatus"),
  optionA: document.querySelector("#optionA"),
  optionB: document.querySelector("#optionB"),
  roundCount: document.querySelector("#roundCount"),
  pendingCount: document.querySelector("#pendingCount"),
  totalCount: document.querySelector("#totalCount"),
  quitButton: document.querySelector("#quitButton"),
  restartButton: document.querySelector("#restartButton"),
  playAgainButton: document.querySelector("#playAgainButton"),
  timerDisplay: document.querySelector("#timerDisplay"),
  winnerTitle: document.querySelector("#winnerTitle"),
  winnerScore: document.querySelector("#winnerScore"),
  winnerRank: document.querySelector("#winnerRank"),
  selectedTotal: document.querySelector("#selectedTotal"),
  finalPending: document.querySelector("#finalPending"),
  finalTime: document.querySelector("#finalTime"),
  scoreBreakdownGrid: document.querySelector("#scoreBreakdownGrid"),
  historyRows: document.querySelector("#historyRows"),
};

const requiredColumns = {
  brand: "Brand",
  model: "Model",
  version: "Version",
  score: "OVERALL SCORE (0-100)",
  rarity: "Score_Rarity (25%)",
  power: "Score_Power (20%)",
  speed: "Score_Speed (20%)",
  torque: "Score_Torque (15%)",
  value: "Score_Value (20%)",
};

function identity(car) {
  return `${car.brand} | ${car.model} | ${car.version}`.toLowerCase();
}

function formatCarName(car) {
  return `${car.brand} ${car.model} ${car.version}`;
}

function normalizeRows(rows) {
  const seen = new Set();
  const cars = [];

  rows.forEach((row, index) => {
    const car = {
      id: row.id || `car-${index + 1}`,
      brand: String(row.brand ?? row.Brand ?? "").trim(),
      model: String(row.model ?? row.Model ?? "").trim(),
      version: String(row.version ?? row.Version ?? "").trim(),
      country: String(row.country ?? row["Country of Origin"] ?? "").trim(),
      launchYear: toNumber(row.launchYear ?? row["Launch Year"]),
      propulsion: String(row.propulsion ?? row["Propulsion Type"] ?? "").trim(),
      unitsProduced: toNumber(row.unitsProduced ?? row["Units Produced"]),
      priceUsd: toNumber(row.priceUsd ?? row["Estimated Price (USD)"]),
      powerHp: toNumber(row.powerHp ?? row["Max Power (hp)"]),
      topSpeedKmh: toNumber(row.topSpeedKmh ?? row["Top Speed (km/h)"]),
      torqueNm: toNumber(row.torqueNm ?? row["Torque (Nm)"]),
      photoUrl: normalizePhotoUrl(row.photoUrl ?? row["Photo URL"] ?? ""),
      scoreRarity: toNumber(row.scoreRarity ?? row[requiredColumns.rarity]),
      scorePower: toNumber(row.scorePower ?? row[requiredColumns.power]),
      scoreSpeed: toNumber(row.scoreSpeed ?? row[requiredColumns.speed]),
      scoreTorque: toNumber(row.scoreTorque ?? row[requiredColumns.torque]),
      scoreValue: toNumber(row.scoreValue ?? row[requiredColumns.value] ?? row.socreValue),
      overallScore: toNumber(row.overallScore ?? row[requiredColumns.score]),
    };

    if (!car.brand || !car.model || !car.version || seen.has(identity(car))) return;
    seen.add(identity(car));
    cars.push(car);
  });

  const ranked = [...cars].sort((a, b) => {
    const scoreDelta = (b.overallScore ?? -Infinity) - (a.overallScore ?? -Infinity);
    return scoreDelta || formatCarName(a).localeCompare(formatCarName(b), "pt-BR");
  });

  ranked.forEach((car, index) => {
    car.overallPosition = index + 1;
  });

  return cars;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function randomFrom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function startGame(cars) {
  state.cars = normalizeRows(cars);
  if (state.cars.length < 2) {
    setLoadStatus("A base precisa ter pelo menos duas opções válidas.", true);
    return;
  }

  resetGame();
  els.setupPanel.hidden = true;
  els.resultPanel.hidden = true;
  els.gamePanel.hidden = false;
  updateCounters();
  renderRound();
}

function resetGame() {
  state.champion = null;
  state.challenger = null;
  state.seenIds = new Set();
  state.selectionHistory = [];
  state.round = 0;
  state.ended = false;
  resetTimer();

  const first = randomFrom(state.cars);
  state.seenIds.add(first.id);
  const second = drawNewChallenger();
  state.champion = first;
  state.challenger = second;
  startTimer();
}

function drawNewChallenger() {
  const available = state.cars.filter((car) => !state.seenIds.has(car.id));
  if (!available.length) return null;
  const picked = randomFrom(available);
  state.seenIds.add(picked.id);
  return picked;
}

function selectWinner(car) {
  if (state.ended) return;

  state.champion = car;
  state.selectionHistory.push(car);
  state.round += 1;

  const next = drawNewChallenger();
  if (!next) {
    endGame("A lista foi esgotada.");
    return;
  }

  state.challenger = next;
  renderRound();
}

function renderRound() {
  renderCard(els.optionA, state.champion);
  renderCard(els.optionB, state.challenger);
  updateCounters();
}

function renderCard(target, car) {
  target.innerHTML = "";
  const photo = renderPhoto(car);

  const body = document.createElement("div");
  body.className = "car-body";
  body.innerHTML = `
    <p class="brand">${escapeHtml(car.brand)}</p>
    <h2 class="car-name">${escapeHtml(car.model)}</h2>
    <p class="version">${escapeHtml(car.version)}</p>
    <div class="card-detail-grid" aria-label="Parâmetros desta opção">
      <span>País de origem<strong>${escapeHtml(car.country || "N/D")}</strong></span>
      <span>Ano de lançamento<strong>${formatValue(car.launchYear)}</strong></span>
      <span>Propulsão<strong>${escapeHtml(car.propulsion || "N/D")}</strong></span>
      <span>Velocidade máxima<strong>${formatValue(car.topSpeedKmh, " km/h")}</strong></span>
      <span>Torque<strong>${formatValue(car.torqueNm, " Nm")}</strong></span>
    </div>
    ${renderMarketIndicator(car)}
  `;

  const button = document.createElement("button");
  button.className = "pick-button";
  button.type = "button";
  button.textContent = "Escolher este";
  button.addEventListener("click", () => selectWinner(car));

  body.appendChild(button);
  target.append(photo, body);
}

function renderPhoto(car) {
  const frame = document.createElement("div");
  frame.className = "photo-frame";

  if (!car.photoUrl) {
    frame.classList.add("photo-placeholder");
    frame.textContent = "Foto indisponível";
    return frame;
  }

  const image = document.createElement("img");
  image.src = car.photoUrl;
  image.alt = `${formatCarName(car)}`;
  image.loading = "lazy";
  image.addEventListener("error", () => {
    frame.classList.add("photo-placeholder");
    frame.textContent = "Foto indisponível";
    image.remove();
  });

  frame.appendChild(image);
  return frame;
}

function formatValue(value, suffix = "") {
  if (value === null || value === undefined) return "N/D";
  return `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`;
}

function renderMarketIndicator(car) {
  const indicator = getMarketIndicator(car.brand);
  if (!indicator) {
    return `
      <div class="market-panel market-neutral">
        <span>Mercado da marca</span>
        <strong>Sem indicador cadastrado</strong>
        <small>Marca sem mapeamento de cotação/proxy.</small>
      </div>
    `;
  }

  const hasQuote = indicator.status === "ok" && indicator.price !== null && indicator.price !== undefined;
  const tone = hasQuote ? getMarketTone(indicator.changePercent) : "neutral";
  const isProxy = indicator.relationType && !["direct", "private", "unavailable"].includes(indicator.relationType);
  const title = isProxy ? car.brand : indicator.marketEntity || car.brand;
  const ticker = !isProxy && indicator.displayTicker ? ` · ${escapeHtml(indicator.displayTicker)}` : "";
  const source = isProxy
    ? `Fonte proxy: ${escapeHtml(indicator.marketEntity || "N/D")}${indicator.displayTicker ? ` · ${escapeHtml(indicator.displayTicker)}` : ""}`
    : "";
  const quoteLine = hasQuote
    ? `${formatMarketPrice(indicator.price, indicator.currency)} · ${formatMarketChange(indicator.changePercent)}`
    : getMarketStatusText(indicator.status);
  const date = indicator.latestTradingDay ? `Atualizado: ${escapeHtml(indicator.latestTradingDay)}` : "";
  const noteParts = [source, indicator.relationLabel ? escapeHtml(indicator.relationLabel) : "", date].filter(Boolean);

  return `
    <div class="market-panel market-${tone}">
      <span>Mercado da marca</span>
      <strong>${escapeHtml(title)}${ticker}</strong>
      <b>${quoteLine}</b>
      <small>${noteParts.join(" · ")}</small>
    </div>
  `;
}

function getMarketIndicator(brand) {
  return window.MARKET_DATA?.indicators?.[brand] || null;
}

function formatMarketPrice(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "N/D";
  return `${currency || ""} ${number.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function formatMarketChange(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "var. N/D";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function getMarketTone(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "neutral";
  return number > 0 ? "up" : "down";
}

function getMarketStatusText(status) {
  const messages = {
    missing_api_key: "Aguardando chave de API",
    not_listed: "Sem cotação pública",
    no_quote: "Cotação temporariamente indisponível",
    rate_limited: "Cotação temporariamente indisponível",
    temporary_unavailable: "Cotação temporariamente indisponível",
    error: "Cotação temporariamente indisponível",
  };
  return messages[status] || "Aguardando atualização";
}

function updateCounters() {
  els.roundCount.textContent = String(state.round);
  els.pendingCount.textContent = String(getPendingCount());
  els.totalCount.textContent = String(state.cars.length);
  els.timerDisplay.textContent = formatDuration(getElapsedMs());
}

function getPendingCount() {
  return Math.max(state.cars.length - state.seenIds.size, 0);
}

function endGame(reason) {
  state.ended = true;
  stopTimer();
  els.gamePanel.hidden = true;
  els.resultPanel.hidden = false;
  updateCounters();

  const winner = state.champion;
  els.winnerTitle.textContent = formatCarName(winner);
  els.winnerScore.textContent = winner.overallScore === null ? "N/D" : winner.overallScore.toFixed(2);
  els.winnerRank.textContent = winner.overallPosition
    ? `${winner.overallPosition} de ${state.cars.length}`
    : "N/D";
  els.selectedTotal.textContent = String(state.selectionHistory.length);
  els.finalPending.textContent = `${getPendingCount()} (${reason})`;
  els.finalTime.textContent = formatDuration(state.elapsedMs);

  renderScoreBreakdown(winner);
  renderHistoryTable();
}

function startTimer() {
  stopTimer();
  state.timerStartedAt = Date.now();
  state.timerId = window.setInterval(updateCounters, 1000);
  updateCounters();
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }

  if (state.timerStartedAt) {
    state.elapsedMs = getElapsedMs();
    state.timerStartedAt = null;
  }
}

function resetTimer() {
  stopTimer();
  state.elapsedMs = 0;
  state.timerStartedAt = null;
  els.timerDisplay.textContent = formatDuration(0);
}

function getElapsedMs() {
  if (!state.timerStartedAt) return state.elapsedMs;
  return state.elapsedMs + Date.now() - state.timerStartedAt;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value) => String(value).padStart(2, "0");
  return hours ? `${two(hours)}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

function renderScoreBreakdown(car) {
  const scores = [
    ["Rarity", car.scoreRarity],
    ["Power", car.scorePower],
    ["Speed", car.scoreSpeed],
    ["Torque", car.scoreTorque],
    ["Value", car.scoreValue],
    ["Overall", car.overallScore],
  ];

  els.scoreBreakdownGrid.innerHTML = scores
    .map(([label, value]) => `<span>${label}<strong>${formatScore(value)}</strong></span>`)
    .join("");
}

function renderHistoryTable() {
  const history = uniqueCarsById(state.selectionHistory.length ? state.selectionHistory : [state.champion]);
  els.historyRows.innerHTML = history
    .map(
      (car, index) => `
        <tr>
          <td><strong>${index + 1}</strong></td>
          <td>${escapeHtml(car.brand)}</td>
          <td>${escapeHtml(car.model)}</td>
          <td>${escapeHtml(car.version)}</td>
          <td class="score">${formatScore(car.scoreRarity)}</td>
          <td class="score">${formatScore(car.scorePower)}</td>
          <td class="score">${formatScore(car.scoreSpeed)}</td>
          <td class="score">${formatScore(car.scoreTorque)}</td>
          <td class="score">${formatScore(car.scoreValue)}</td>
          <td class="score"><strong>${formatScore(car.overallScore)}</strong></td>
        </tr>
      `,
    )
    .join("");
}

function uniqueCarsById(cars) {
  const seen = new Set();
  return cars.filter((car) => {
    if (!car || seen.has(car.id)) return false;
    seen.add(car.id);
    return true;
  });
}

function formatScore(value) {
  return value === null || value === undefined ? "N/D" : Number(value).toFixed(2);
}

function normalizePhotoUrl(value) {
  let url = String(value ?? "").trim();
  if (!url) return "";

  if (/^www\./i.test(url)) url = `https://${url}`;
  if (/^[a-z]:\\/i.test(url)) {
    url = `file:///${url.replace(/\\/g, "/").replace(/ /g, "%20")}`;
  }

  const googleDriveFile = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (googleDriveFile) return `https://drive.google.com/uc?export=view&id=${googleDriveFile[1]}`;

  const googleDriveOpen = url.match(/[?&]id=([^&]+)/i);
  if (/drive\.google\.com/i.test(url) && googleDriveOpen) {
    return `https://drive.google.com/uc?export=view&id=${googleDriveOpen[1]}`;
  }

  if (/dropbox\.com/i.test(url)) {
    return url.includes("?") ? url.replace(/([?&])dl=0\b/, "$1dl=1") : `${url}?dl=1`;
  }

  return url;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function setLoadStatus(message, isError = false) {
  els.loadStatus.textContent = message;
  els.loadStatus.style.color = isError ? "#ffb4a6" : "#aeb8bd";
}

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  setLoadStatus("Lendo a planilha...");

  try {
    const rows = await readXlsxRows(file);
    startGame(rows);
  } catch (error) {
    console.error(error);
    setLoadStatus(error.message || "Não foi possível ler a planilha.", true);
  }
});

els.quitButton.addEventListener("click", () => endGame("Jogo encerrado pelo jogador."));
els.restartButton.addEventListener("click", () => {
  resetGame();
  els.resultPanel.hidden = true;
  els.gamePanel.hidden = false;
  renderRound();
});
els.playAgainButton.addEventListener("click", () => {
  resetGame();
  els.resultPanel.hidden = true;
  els.gamePanel.hidden = false;
  renderRound();
});

async function readXlsxRows(file) {
  const entries = await unzipXlsx(file);
  const workbookXml = await getTextEntry(entries, "xl/workbook.xml");
  const relsXml = await getTextEntry(entries, "xl/_rels/workbook.xml.rels");
  const sheetPath = getFirstSheetPath(workbookXml, relsXml);
  const sheetRelsPath = getSheetRelsPath(sheetPath);
  const sheetRelsXml = entries.has(sheetRelsPath) ? await getTextEntry(entries, sheetRelsPath) : "";
  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? parseSharedStrings(await getTextEntry(entries, "xl/sharedStrings.xml"))
    : [];
  const sheetXml = await getTextEntry(entries, sheetPath);
  const matrix = parseSheet(sheetXml, sharedStrings, sheetRelsXml);
  return matrixToObjects(matrix);
}

async function unzipXlsx(file) {
  if (!("DecompressionStream" in window)) {
    throw new Error("Este navegador não oferece suporte para importar .xlsx localmente.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = new Map();
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);

  for (let i = 0; i < entryCount; i += 1) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : await inflateRaw(compressed);
    entries.set(name.replace(/\\/g, "/"), data);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(bytes) {
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  throw new Error("Arquivo .xlsx inválido.");
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decode(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

async function getTextEntry(entries, path) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Arquivo interno ausente no Excel: ${path}`);
  return decode(bytes);
}

function getFirstSheetPath(workbookXml, relsXml) {
  const parser = new DOMParser();
  const workbook = parser.parseFromString(workbookXml, "application/xml");
  const rels = parser.parseFromString(relsXml, "application/xml");
  const firstSheet = workbook.querySelector("sheet");
  const relationshipId = firstSheet?.getAttribute("r:id");
  const rel = [...rels.querySelectorAll("Relationship")].find(
    (item) => item.getAttribute("Id") === relationshipId,
  );
  const target = rel?.getAttribute("Target");
  if (!target) throw new Error("Não encontrei a primeira aba da planilha.");
  return `xl/${target.replace(/^\/?xl\//, "")}`.replace(/\\/g, "/");
}

function getSheetRelsPath(sheetPath) {
  const parts = sheetPath.split("/");
  const fileName = parts.pop();
  return `${parts.join("/")}/_rels/${fileName}.rels`;
}

function parseSharedStrings(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.querySelectorAll("si")].map((si) =>
    [...si.querySelectorAll("t")].map((node) => node.textContent).join(""),
  );
}

function parseSheet(xml, sharedStrings, sheetRelsXml = "") {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const hyperlinks = parseSheetHyperlinks(doc, sheetRelsXml);
  return [...doc.querySelectorAll("sheetData row")].map((row) => {
    const values = [];
    [...row.querySelectorAll("c")].forEach((cell) => {
      const ref = cell.getAttribute("r") || "";
      const columnIndex = columnNameToIndex(ref.replace(/[0-9]/g, ""));
      const rawValue = cell.querySelector("v")?.textContent ?? "";
      const formula = cell.querySelector("f")?.textContent ?? "";
      const type = cell.getAttribute("t");
      const cellValue =
        type === "s"
          ? sharedStrings[Number(rawValue)]
          : type === "inlineStr"
            ? cell.querySelector("is t")?.textContent ?? ""
            : rawValue;
      values[columnIndex] = hyperlinks.get(ref) || parseHyperlinkFormula(formula) || cellValue;
    });
    return values;
  });
}

function parseSheetHyperlinks(sheetDoc, relsXml) {
  const links = new Map();
  if (!relsXml) return links;

  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");
  const relTargets = new Map(
    [...relsDoc.querySelectorAll("Relationship")].map((rel) => [
      rel.getAttribute("Id"),
      rel.getAttribute("Target"),
    ]),
  );

  sheetDoc.querySelectorAll("hyperlink").forEach((link) => {
    const ref = link.getAttribute("ref");
    const id = link.getAttribute("r:id");
    const target = id ? relTargets.get(id) : null;
    if (ref && target) links.set(ref, target);
  });

  return links;
}

function parseHyperlinkFormula(formula) {
  const match = formula.match(/^HYPERLINK\("([^"]+)"/i);
  return match ? match[1] : "";
}

function columnNameToIndex(name) {
  return [...name].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function matrixToObjects(matrix) {
  const headerIndex = matrix.findIndex((row) =>
    [requiredColumns.brand, requiredColumns.model, requiredColumns.version, requiredColumns.score].every(
      (column) => row.includes(column),
    ),
  );
  if (headerIndex === -1) {
    throw new Error("Não encontrei as colunas obrigatórias na planilha.");
  }

  const headers = matrix[headerIndex];
  return matrix.slice(headerIndex + 1).map((row) => {
    return headers.reduce((record, header, index) => {
      if (header) record[header] = row[index] ?? "";
      return record;
    }, {});
  });
}

if (Array.isArray(window.HYPERCARS) && window.HYPERCARS.length) {
  startGame(window.HYPERCARS);
} else {
  setLoadStatus("Nenhuma base embutida encontrada. Selecione a planilha para começar.");
  els.totalCount.textContent = "0";
}
