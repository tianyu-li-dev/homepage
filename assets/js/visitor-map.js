(() => {
  "use strict";

  const config = window.VISITOR_MAP_CONFIG || {};
  const apiBase = String(config.apiBase || "").replace(/\/$/, "");
  const timeZone = config.displayTimeZone || "America/Indiana/Indianapolis";
  const summaryEl = document.getElementById("visitor-map-summary");
  const recentEl = document.getElementById("visitor-recent-list");
  const svgEl = document.getElementById("visitor-world-map");
  const tooltipEl = document.getElementById("visitor-map-tooltip");
  const mapFrame = svgEl?.closest(".visitor-map-frame");

  if (!summaryEl || !recentEl || !svgEl || !tooltipEl || !mapFrame) return;

  if (!apiBase || apiBase.includes("REPLACE")) {
    summaryEl.textContent = "Visitor map is not configured yet.";
    recentEl.textContent = "Add your Cloudflare Worker URL to _config.yml.";
    return;
  }

  const countryNames = (() => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" });
    } catch (_) {
      return null;
    }
  })();

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString || "Unknown time";
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    }).format(date);
  };

  const countryName = (code) => {
    if (!code) return "Unknown country";
    try {
      return countryNames?.of(code) || code;
    } catch (_) {
      return code;
    }
  };

  const placeName = (visit) => {
    return [visit.city, visit.region, countryName(visit.country_code)]
      .filter(Boolean)
      .join(", ");
  };

  const trackVisit = async () => {
    try {
      await fetch(`${apiBase}/track`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: window.location.pathname,
          referrer: document.referrer || ""
        })
      });
    } catch (error) {
      console.warn("Visitor tracking request failed:", error);
    }
  };

  const loadStats = async () => {
    const response = await fetch(`${apiBase}/public-stats`, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Statistics request failed: ${response.status}`);
    return response.json();
  };

  const loadWorld = async () => {
    const response = await fetch(
      "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json",
      { cache: "force-cache" }
    );
    if (!response.ok) throw new Error("World map data could not be loaded.");
    return response.json();
  };

  const showTooltip = (event, city) => {
    tooltipEl.innerHTML = "";

    const place = document.createElement("strong");
    place.textContent = placeName(city);
    tooltipEl.appendChild(place);

    const count = document.createElement("div");
    count.textContent = `${city.visits} visit${city.visits === 1 ? "" : "s"}`;
    tooltipEl.appendChild(count);

    const latest = document.createElement("div");
    latest.textContent = `Latest: ${formatTime(city.latest_visit)}`;
    tooltipEl.appendChild(latest);

    const frameRect = mapFrame.getBoundingClientRect();
    tooltipEl.style.left = `${event.clientX - frameRect.left + 12}px`;
    tooltipEl.style.top = `${event.clientY - frameRect.top + 12}px`;
    tooltipEl.hidden = false;
  };

  const hideTooltip = () => {
    tooltipEl.hidden = true;
  };

  const renderMap = (world, stats) => {
    if (!window.d3 || !window.topojson) {
      throw new Error("Map libraries did not load.");
    }

    const width = 960;
    const height = 500;
    const countries = window.topojson.feature(world, world.objects.countries);
    const projection = window.d3.geoNaturalEarth1().fitExtent(
      [[8, 8], [width - 8, height - 8]],
      countries
    );
    const path = window.d3.geoPath(projection);
    const svg = window.d3.select(svgEl);

    svg.selectAll("*").remove();

    svg
      .append("g")
      .selectAll("path")
      .data(countries.features)
      .join("path")
      .attr("class", "visitor-country")
      .attr("d", path);

    const visibleCities = (stats.cities || []).filter((city) => {
      const latitude = Number(city.latitude);
      const longitude = Number(city.longitude);
      return Number.isFinite(latitude) && Number.isFinite(longitude);
    });

    const points = svg
      .append("g")
      .selectAll("circle")
      .data(visibleCities)
      .join("circle")
      .attr("class", "visitor-city-point")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (d) => `${placeName(d)}, ${d.visits} visits, latest ${formatTime(d.latest_visit)}`)
      .attr("cx", (d) => projection([Number(d.longitude), Number(d.latitude)])?.[0] ?? -100)
      .attr("cy", (d) => projection([Number(d.longitude), Number(d.latitude)])?.[1] ?? -100)
      .attr("r", (d) => Math.min(12, 3 + Math.sqrt(Number(d.visits) || 1) * 1.5));

    points
      .on("mouseenter", showTooltip)
      .on("mousemove", showTooltip)
      .on("mouseleave", hideTooltip)
      .on("focus", function (event, d) {
        const box = this.getBoundingClientRect();
        showTooltip({ clientX: box.left + box.width / 2, clientY: box.top }, d);
      })
      .on("blur", hideTooltip);
  };

  const renderRecent = (recent) => {
    recentEl.innerHTML = "";
    if (!recent?.length) {
      recentEl.textContent = "No public city-level visits recorded yet.";
      return;
    }

    recent.slice(0, 20).forEach((visit) => {
      const item = document.createElement("div");
      item.className = "visitor-recent-item";

      const place = document.createElement("span");
      place.className = "visitor-recent-place";
      place.textContent = placeName(visit);

      const time = document.createElement("span");
      time.className = "visitor-recent-time";
      time.textContent = formatTime(visit.visited_at);

      item.append(place, time);
      recentEl.appendChild(item);
    });
  };

  const init = async () => {
    try {
      await trackVisit();
      const [world, stats] = await Promise.all([loadWorld(), loadStats()]);
      const total = Number(stats.total_visits) || 0;
      const cities = Number(stats.city_count) || 0;
      const days = Number(stats.period_days) || Number(config.publicDays) || 30;
      summaryEl.textContent = `${total} visit${total === 1 ? "" : "s"} from ${cities} cit${cities === 1 ? "y" : "ies"} during the last ${days} days.`;
      renderMap(world, stats);
      renderRecent(stats.recent || []);
    } catch (error) {
      console.error(error);
      summaryEl.textContent = "Visitor data is temporarily unavailable.";
      recentEl.textContent = "Please try again later.";
    }
  };

  init();
})();
