const API_BASE = "https://data.gov.il/api/3/action/datastore_search";

const RESOURCES = {
  localitiesByYear: {
    2023: "d47a54ff-87f0-44b3-b33a-f284c0c38e5a",
    2022: "199b15db-3bcb-470e-ba03-73364737e352",
    2021: "95435941-d7e5-46c6-876a-761a74a5928d",
    2020: "2d218594-73e3-40de-b36b-23b22f0a2627",
    2019: "990ae78e-2dae-4a15-a13b-0b5dcc56056c",
    2018: "9d4fa9d4-b20b-4182-a14d-22785d610135",
  },
  census2022Selected: "9a9e085f-3bc8-41df-b15f-be0daaf99e30",
};

const FALLBACK_DATA_PATH = "./data/cities-sample.json";
const HISTORY_YEARS = [2018, 2019, 2020, 2021, 2022, 2023];

const citySelect = document.querySelector("#city-select");
const compareCitySelect = document.querySelector("#compare-city-select");
const citySearch = document.querySelector("#city-search");
const kpiGrid = document.querySelector("#kpi-grid");
const template = document.querySelector("#kpi-template");
const cityDescription = document.querySelector("#city-description");
const dataYear = document.querySelector("#data-year");
const dataSource = document.querySelector("#data-source");
const populationChart = document.querySelector("#population-chart");
const historyPopulationChart = document.querySelector("#history-population-chart");
const historyDeltaSvg = document.querySelector("#history-delta-svg");
const historyDeltaLabels = document.querySelector("#history-delta-labels");
const historyRankSvg = document.querySelector("#history-rank-svg");
const historyRankLabels = document.querySelector("#history-rank-labels");
const historyRankLegend = document.querySelector("#history-rank-legend");

const numberFormatter = new Intl.NumberFormat("he-IL");
const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

let allCities = [];

bootstrap().catch((error) => {
  console.error(error);
  cityDescription.textContent =
    "לא הצלחנו לטעון נתונים כרגע. נסה שוב בעוד כמה דקות.";
});

async function bootstrap() {
  let payload;
  try {
    payload = await loadFromLamas();
  } catch (error) {
    console.error("LAMAS API failed, loading fallback sample", error);
    payload = await loadFallbackSample();
  }

  allCities = payload.cities.sort((a, b) => a.name.localeCompare(b.name, "he"));

  dataYear.textContent = String(payload.meta.year);
  dataSource.textContent = payload.meta.source;

  initCitySelect(allCities);
  initCompareCitySelect(allCities);
  renderCity(allCities[0]);
  renderPopulationChart(allCities);

  citySelect.addEventListener("change", () => {
    const selected = allCities.find((city) => city.name === citySelect.value);
    if (selected) renderCity(selected);
  });

  compareCitySelect.addEventListener("change", () => {
    const selected = allCities.find((city) => city.name === citySelect.value);
    if (selected) renderCity(selected);
  });

  citySearch.addEventListener("input", handleSearch);
}

async function loadFromLamas() {
  const yearlyFetches = HISTORY_YEARS.map((year) =>
    fetchAllRecords(RESOURCES.localitiesByYear[year]).then((rows) => ({ year, rows }))
  );

  const [censusRows, ...yearlyResources] = await Promise.all([
    fetchAllRecords(RESOURCES.census2022Selected),
    ...yearlyFetches,
  ]);

  const historyByCode = new Map();

  yearlyResources.forEach(({ year, rows }) => {
    const populationField = findPopulationField(rows[0] || {}, year);

    rows.forEach((row) => {
      const code = toNumber(row["סמל יישוב"]);
      if (!Number.isFinite(code)) return;

      const population = toNumber(row[populationField]);
      if (!Number.isFinite(population)) return;

      let item = historyByCode.get(code);
      if (!item) {
        item = {
          name: row["שם יישוב"] || null,
          districtName: row["שם מחוז"] || null,
          municipalStatus: row["שם מעמד מונציפאלי"] || null,
          localAuthorityCluster: row["אשכול רשויות מקומיות"] || null,
          populationHistory: {},
          populationRankHistory: {},
        };
        historyByCode.set(code, item);
      }

      item.name = item.name || row["שם יישוב"] || null;
      item.populationHistory[year] = population;

      if (!item.districtName) item.districtName = row["שם מחוז"] || null;
      if (!item.municipalStatus) item.municipalStatus = row["שם מעמד מונציפאלי"] || null;
      if (!item.localAuthorityCluster) {
        item.localAuthorityCluster = row["אשכול רשויות מקומיות"] || null;
      }
    });
  });

  const cities = censusRows
    .filter(
      (row) =>
        row.LocalityCode &&
        !row.StatArea &&
        row.LocNameHeb &&
        row.LocNameHeb !== "כלל ארצי"
    )
    .map((row) => {
      const code = toNumber(row.LocalityCode);
      const historyMeta = historyByCode.get(code) || {};
      const populationHistory = historyMeta.populationHistory || {};
      const latestPopulation =
        toNumber(populationHistory[2023]) ??
        toNumber(populationHistory[2022]) ??
        toNumber(row.pop_approx);

      return {
        code,
        name: row.LocNameHeb,
        population: latestPopulation,
        localAuthorityCluster: historyMeta.localAuthorityCluster || null,
        medianAnnualSalaryNis: toNumber(row.employeesAnnual_medWage),
        employmentRate: toFloat(row.Empl_pcnt),
        annualGrowthPercent: toFloat(row.change_pcnt),
        districtName: historyMeta.districtName || null,
        municipalStatus: historyMeta.municipalStatus || null,
        populationHistory,
        populationRankHistory: {},
      };
    })
    .filter((city) => Number.isFinite(city.population) && city.population > 0)
    .sort((a, b) => b.population - a.population);

  const uniqueByName = [];
  const seen = new Set();
  cities.forEach((city) => {
    if (seen.has(city.name)) return;
    seen.add(city.name);
    uniqueByName.push(city);
  });

  applyYearlyPopulationRanks(uniqueByName);

  return {
    meta: {
      source: "הלמ\"ס + data.gov.il (יישובים 2018-2023, מפקד 2022)",
      year: 2023,
    },
    cities: uniqueByName,
  };
}

function applyYearlyPopulationRanks(cities) {
  HISTORY_YEARS.forEach((year) => {
    const ranked = cities
      .map((city) => ({
        city,
        pop: toNumber(city.populationHistory?.[year]),
      }))
      .filter((item) => Number.isFinite(item.pop))
      .sort((a, b) => b.pop - a.pop);

    ranked.forEach((item, index) => {
      item.city.populationRankHistory[year] = index + 1;
    });
  });
}

async function loadFallbackSample() {
  const response = await fetch(FALLBACK_DATA_PATH);
  if (!response.ok) {
    throw new Error("Fallback file is not available");
  }
  const fallback = await response.json();

  fallback.cities = (fallback.cities || []).map((city) => {
    const base = toNumber(city.population);
    return {
      ...city,
      populationHistory: {
        2018: Math.round(base * 0.92),
        2019: Math.round(base * 0.94),
        2020: Math.round(base * 0.96),
        2021: Math.round(base * 0.98),
        2022: Math.round(base * 0.99),
        2023: base,
      },
      populationRankHistory: {},
    };
  });

  applyYearlyPopulationRanks(fallback.cities);
  return fallback;
}

async function fetchAllRecords(resourceId, limit = 5000) {
  let offset = 0;
  let all = [];

  while (true) {
    const url = `${API_BASE}?resource_id=${resourceId}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed API call for ${resourceId} at offset ${offset}`);
    }

    const payload = await response.json();
    const records = payload?.result?.records || [];
    all = all.concat(records);

    if (records.length < limit) {
      break;
    }

    offset += limit;
  }

  return all;
}

function findPopulationField(row, year) {
  const expected = `סך הכל אוכלוסייה ${year} - ארעי`;
  if (Object.hasOwn(row, expected)) return expected;

  const match = Object.keys(row).find(
    (key) => key.includes("סך הכל אוכלוסייה") && key.includes(String(year))
  );

  return match || expected;
}

function initCitySelect(cities) {
  const options = cities
    .map((city) => `<option value="${escapeHtml(city.name)}">${city.name}</option>`)
    .join("");
  citySelect.innerHTML = options;
}

function initCompareCitySelect(cities) {
  const options = cities
    .map((city) => `<option value="${escapeHtml(city.name)}">${city.name}</option>`)
    .join("");
  compareCitySelect.innerHTML = `<option value="">ללא השוואה</option>${options}`;
}

function handleSearch() {
  const term = citySearch.value.trim();
  if (!term) {
    initCitySelect(allCities);
    citySelect.selectedIndex = 0;
    const selected = allCities[0];
    renderCity(selected);
    return;
  }

  const filtered = allCities.filter((city) => city.name.includes(term));
  if (filtered.length === 0) return;

  initCitySelect(filtered);
  citySelect.selectedIndex = 0;
  renderCity(filtered[0]);
}

function renderCity(city) {
  cityDescription.textContent = createCityDescription(city);

  const cards = [
    {
      label: "אוכלוסייה",
      value: formatNumber(city.population),
      note: "תושבים",
    },
    {
      label: "אשכול רשות מקומית",
      value: city.localAuthorityCluster || "לא זמין",
      note: "מתוך קובץ היישובים",
    },
    {
      label: "שכר שנתי חציוני לשכירים",
      value: formatCurrency(city.medianAnnualSalaryNis),
      note: "ש" + "ח בשנה",
    },
    {
      label: "שיעור תעסוקה",
      value: formatPercent(city.employmentRate),
      note: "בקרב מועסקים/כוח עבודה",
    },
    {
      label: "שינוי אוכלוסייה",
      value: formatPercent(city.annualGrowthPercent),
      note: "באחוזים",
    },
  ];

  kpiGrid.innerHTML = "";
  cards.forEach((kpi) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".kpi-label").textContent = kpi.label;
    node.querySelector(".kpi-value").textContent = kpi.value;
    node.querySelector(".kpi-note").textContent = kpi.note;
    kpiGrid.appendChild(node);
  });

  renderPopulationHistory(city);
  renderPopulationDeltaHistory(city);
  renderPopulationRankHistory(city);
  citySelect.value = city.name;
}

function renderPopulationChart(cities) {
  const top = [...cities]
    .sort((a, b) => b.population - a.population)
    .slice(0, 6);

  const maxPopulation = top[0]?.population ?? 1;
  populationChart.innerHTML = "";

  top.forEach((city) => {
    const ratio = (city.population / maxPopulation) * 100;

    const row = document.createElement("div");
    row.className = "bar-row";

    row.innerHTML = `
      <div class="bar-label">${escapeHtml(city.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${ratio}%"></div></div>
      <div class="bar-value">${formatNumber(city.population)}</div>
    `;

    populationChart.appendChild(row);
  });
}

function renderPopulationHistory(city) {
  const series = HISTORY_YEARS.map((year) => ({
    year,
    value: toNumber(city.populationHistory?.[year]),
  })).filter((item) => Number.isFinite(item.value));

  historyPopulationChart.innerHTML = "";

  if (series.length === 0) {
    historyPopulationChart.innerHTML = "<p class='meta'>אין נתונים היסטוריים להצגה.</p>";
    return;
  }

  const maxPopulation = Math.max(...series.map((item) => item.value));

  series.forEach((item) => {
    const ratio = (item.value / maxPopulation) * 100;

    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label">${item.year}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${ratio}%"></div></div>
      <div class="bar-value">${formatNumber(item.value)}</div>
    `;

    historyPopulationChart.appendChild(row);
  });
}

function renderPopulationDeltaHistory(city) {
  const series = HISTORY_YEARS.map((year) => ({
    year,
    value: toNumber(city.populationHistory?.[year]),
  })).filter((item) => Number.isFinite(item.value));

  const deltas = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1].value;
    const curr = series[i].value;
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(curr)) continue;
    const delta = ((curr - prev) / prev) * 100;
    deltas.push({
      label: `${series[i - 1].year}-${series[i].year}`,
      value: delta,
    });
  }

  historyDeltaLabels.innerHTML = "";
  historyDeltaSvg.innerHTML = "";

  if (deltas.length === 0) {
    historyDeltaLabels.innerHTML = "<div class='history-line-label'>אין מספיק שנים לחישוב שינוי.</div>";
    return;
  }

  const points = mapSeriesToChartPoints(deltas.map((d) => d.value), 640, 210);

  historyDeltaSvg.innerHTML = buildLineSvg(points, {
    width: 640,
    height: 210,
    pathClass: "history-line-path",
    pointClass: "history-line-point",
  });

  historyDeltaLabels.innerHTML = deltas
    .map(
      (d) =>
        `<div class="history-line-label">${escapeHtml(d.label)}: ${formatPercent(d.value)}</div>`
    )
    .join("");
}

function renderPopulationRankHistory(city) {
  const compareCity = getCompareCity(city.name);
  const ranks = HISTORY_YEARS.map((year) => ({
    year,
    rank: toNumber(city.populationRankHistory?.[year]),
  })).filter((item) => Number.isFinite(item.rank));

  const compareRanks = compareCity
    ? HISTORY_YEARS.map((year) => ({
        year,
        rank: toNumber(compareCity.populationRankHistory?.[year]),
      })).filter((item) => Number.isFinite(item.rank))
    : [];

  historyRankLabels.innerHTML = "";
  historyRankSvg.innerHTML = "";
  historyRankLegend.innerHTML = "";

  if (ranks.length === 0) {
    historyRankLabels.innerHTML = "<div class='history-line-label'>אין נתוני דירוג זמינים.</div>";
    return;
  }

  const width = 640;
  const height = 210;

  const primaryValuesForChart = ranks.map((r) => -r.rank);
  const primaryPoints = mapSeriesToChartPoints(primaryValuesForChart, width, height);
  let svgContent = buildLineSvg(primaryPoints, {
    width,
    height,
    pathClass: "history-rank-path",
    pointClass: "history-rank-point",
  });

  historyRankLegend.innerHTML = `
    <div class="history-rank-legend-item"><span class="legend-dot legend-primary"></span>${escapeHtml(city.name)}</div>
    ${
      compareCity
        ? `<div class="history-rank-legend-item"><span class="legend-dot legend-compare"></span>${escapeHtml(compareCity.name)}</div>`
        : ""
    }
  `;

  if (compareRanks.length > 0) {
    const compareValuesForChart = compareRanks.map((r) => -r.rank);
    const comparePoints = mapSeriesToChartPoints(compareValuesForChart, width, height);
    const compareSvg = buildLineOnly(comparePoints, {
      pathClass: "history-rank-compare-path",
      pointClass: "history-rank-compare-point",
    });
    svgContent += compareSvg;
  }

  historyRankSvg.innerHTML = svgContent;

  historyRankLabels.innerHTML = ranks
    .map((r) => {
      const compareForYear = compareRanks.find((x) => x.year === r.year);
      const compareText = compareForYear
        ? ` | ${escapeHtml(compareCity.name)}: מקום ${formatNumber(compareForYear.rank)}`
        : "";

      return `<div class="history-line-label">${r.year}: ${escapeHtml(city.name)} מקום ${formatNumber(r.rank)}${compareText}</div>`;
    })
    .join("");
}

function getCompareCity(primaryCityName) {
  const compareName = compareCitySelect.value;
  if (!compareName || compareName === primaryCityName) return null;
  return allCities.find((city) => city.name === compareName) || null;
}

function mapSeriesToChartPoints(values, width, height) {
  const paddingX = 40;
  const paddingY = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xStep = values.length > 1 ? (width - paddingX * 2) / (values.length - 1) : 0;

  return values.map((value, index) => {
    const x = paddingX + index * xStep;
    const y = height - paddingY - ((value - min) / span) * (height - paddingY * 2);
    return { x, y };
  });
}

function buildLineSvg(points, config) {
  const { width, height, pathClass, pointClass } = config;
  const paddingX = 40;
  const paddingY = 24;

  const grid = `
    <line x1="${paddingX}" y1="${paddingY}" x2="${paddingX}" y2="${height - paddingY}" class="history-line-grid" />
    <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" class="history-line-grid" />
  `;

  const lineOnly = buildLineOnly(points, { pathClass, pointClass });
  return `${grid}${lineOnly}`;
}

function buildLineOnly(points, config) {
  const { pathClass, pointClass } = config;
  const pathD = points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const circles = points
    .map(
      (p) => `<circle class="${pointClass}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4"></circle>`
    )
    .join("");

  return `<path class="${pathClass}" d="${pathD}"></path>${circles}`;
}

function createCityDescription(city) {
  const district = city.districtName ? `מחוז ${city.districtName}` : "מחוז לא זמין";
  const municipal = city.municipalStatus || "מעמד מוניציפלי לא זמין";

  return `${city.name} היא רשות מסוג ${municipal}. שיוך מחוזי: ${district}. הנתונים בדשבורד נשענים על פרסומי הלמ"ס הזמינים דרך data.gov.il.`;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFloat(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatNumber(value) {
  return Number.isFinite(value) ? numberFormatter.format(value) : "לא זמין";
}

function formatCurrency(value) {
  return Number.isFinite(value) ? currencyFormatter.format(value) : "לא זמין";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "לא זמין";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}