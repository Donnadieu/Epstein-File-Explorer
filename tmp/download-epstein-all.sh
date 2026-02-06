#!/bin/bash

# =============================================================================
# DOJ Epstein Disclosure Files Downloader
# Downloads all PDF files from all 12 DOJ data sets
# =============================================================================
#
# Usage:
#   bash tmp/download-epstein-all.sh              # Download all data sets
#   bash tmp/download-epstein-all.sh 6             # Download only data set 6
#   bash tmp/download-epstein-all.sh 1 3           # Download data sets 1 through 3
#
# Features:
#   - Resume support (skips already downloaded files)
#   - Age verification cookie bypass
#   - Rate limiting (configurable delays)
#   - Pagination with fallback to probe-based discovery
#   - Failure logging and retry
# =============================================================================

DOWNLOAD_DIR="${HOME}/Downloads/epstein-disclosures"
FAILED_LOG="${DOWNLOAD_DIR}/failed.txt"
URLS_DIR="${DOWNLOAD_DIR}/urls"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
AGE_COOKIE="justiceGovAgeVerified=true"
PAGE_DELAY=2
DOWNLOAD_DELAY=1
MAX_RETRIES=3

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $*"; }

mkdir -p "$DOWNLOAD_DIR" "$URLS_DIR"
: > "$FAILED_LOG"

BASE_URL="https://www.justice.gov/epstein/doj-disclosures"

fetch_page() {
  local url="$1"
  curl -s --compressed --max-time 30 \
    -H "User-Agent: $UA" \
    -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" \
    -H "Accept-Language: en-US,en;q=0.9" \
    -b "$AGE_COOKIE" \
    "$url" 2>/dev/null || true
}

extract_pdfs_from_html() {
  local html="$1"
  echo "$html" | grep -oE 'href="[^"]*\.pdf"' | sed 's/href="//;s/"//' | sort -u || true
}

extract_max_page_from_html() {
  local html="$1"
  local result
  result=$(echo "$html" | grep -oE 'page=[0-9]+' | sed 's/page=//' | sort -n | tail -1 || true)
  echo "${result:-0}"
}

download_pdf() {
  local url="$1"
  local dest="$2"

  if [ -f "$dest" ] && [ "$(wc -c < "$dest")" -gt 1000 ]; then
    return 0
  fi

  local attempt=0
  while [ $attempt -lt $MAX_RETRIES ]; do
    attempt=$((attempt + 1))
    local status
    status=$(curl -s -L -o "$dest" -w "%{http_code}" \
      --max-time 120 \
      -H "User-Agent: $UA" \
      -b "$AGE_COOKIE" \
      "$url" 2>/dev/null || echo "000")

    if [ "$status" = "200" ] && [ -f "$dest" ] && [ "$(wc -c < "$dest")" -gt 100 ]; then
      return 0
    fi

    if [ $attempt -lt $MAX_RETRIES ]; then
      sleep 2
    fi
  done

  echo "$url" >> "$FAILED_LOG"
  rm -f "$dest"
  return 1
}

check_page_status() {
  local url="$1"
  curl -s -o /dev/null -w "%{http_code}" \
    -H "User-Agent: $UA" \
    -b "$AGE_COOKIE" \
    "$url" 2>/dev/null || echo "000"
}

probe_remaining_files() {
  local ds_num="$1"
  local urls_file="$2"

  local known_urls
  known_urls=$(cat "$urls_file" 2>/dev/null || true)
  local known_count
  known_count=$(echo "$known_urls" | grep -c '\.pdf' || echo 0)

  local first_num last_num
  first_num=$(echo "$known_urls" | grep -oE 'EFTA[0-9]+' | sed 's/EFTA//' | sort -n | head -1 || true)
  last_num=$(echo "$known_urls" | grep -oE 'EFTA[0-9]+' | sed 's/EFTA//' | sort -n | tail -1 || true)

  if [ -z "$first_num" ] || [ -z "$last_num" ]; then
    log_warn "Cannot determine EFTA number range for probe"
    return 0
  fi

  first_num=$((10#$first_num))
  last_num=$((10#$last_num))

  local ds_path
  ds_path=$(echo "$known_urls" | head -1 | sed 's|/[^/]*$|/|')

  local listing_html
  listing_html=$(fetch_page "${BASE_URL}/data-set-${ds_num}-files")
  local max_page
  max_page=$(extract_max_page_from_html "$listing_html")

  local estimated_total=$(( (max_page + 1) * 50 ))
  local search_range=$((estimated_total * 3))
  if [ $search_range -gt 50000 ]; then
    search_range=50000
  fi
  local range_end=$((last_num + search_range))

  log_info "Probing EFTA range: ${first_num} to ${range_end} (estimated ~${estimated_total} total files)"
  log_info "Already known: ${known_count} files"

  local found=0
  local consecutive_misses=0
  local max_consecutive_misses=500
  local current=$first_num
  local checked=0

  while [ $current -le $range_end ] && [ $consecutive_misses -lt $max_consecutive_misses ]; do
    local efta_padded
    efta_padded=$(printf "EFTA%08d" "$current")

    if echo "$known_urls" | grep -q "${efta_padded}" 2>/dev/null; then
      current=$((current + 1))
      consecutive_misses=0
      continue
    fi

    local probe_url="${ds_path}${efta_padded}.pdf"
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
      -I -H "User-Agent: $UA" \
      -b "$AGE_COOKIE" \
      "$probe_url" 2>/dev/null || echo "000")

    checked=$((checked + 1))

    if [ "$status" = "200" ]; then
      echo "$probe_url" >> "$urls_file"
      found=$((found + 1))
      consecutive_misses=0

      if [ $((found % 50)) -eq 0 ]; then
        log_ok "Probe: found ${found} new files so far (at ${efta_padded}, checked ${checked})"
      fi
    else
      consecutive_misses=$((consecutive_misses + 1))
    fi

    current=$((current + 1))

    if [ $((checked % 50)) -eq 0 ]; then
      sleep 0.3
    fi
  done

  log_ok "Probe complete: found ${found} additional files (checked ${checked} numbers)"

  if [ $consecutive_misses -ge $max_consecutive_misses ]; then
    log_info "Stopped after ${max_consecutive_misses} consecutive misses at EFTA$(printf '%08d' $current)"
  fi
}

scrape_data_set() {
  local ds_num="$1"
  local ds_dir="${DOWNLOAD_DIR}/data-set-${ds_num}"
  local urls_file="${URLS_DIR}/data-set-${ds_num}-urls.txt"
  local listing_url="${BASE_URL}/data-set-${ds_num}-files"

  mkdir -p "$ds_dir"

  echo ""
  echo "=============================================="
  log_info "Processing Data Set ${ds_num}"
  echo "=============================================="

  : > "$urls_file"

  log_info "Fetching page 0..."
  local html
  html=$(fetch_page "$listing_url")

  if [ -z "$html" ]; then
    log_err "Failed to fetch page 0 for Data Set ${ds_num}"
    return 0
  fi

  local page0_pdfs
  page0_pdfs=$(extract_pdfs_from_html "$html")
  local page0_count
  page0_count=$(echo "$page0_pdfs" | grep -c '\.pdf' || echo 0)

  local max_page
  max_page=$(extract_max_page_from_html "$html")

  log_info "Page 0: ${page0_count} PDFs found, max page: ${max_page}"

  if [ -n "$page0_pdfs" ]; then
    echo "$page0_pdfs" >> "$urls_file"
  fi

  local pagination_blocked=false

  if [ "$max_page" -gt 0 ] 2>/dev/null; then
    log_info "Fetching pages 1 through ${max_page}..."

    for page in $(seq 1 "$max_page"); do
      sleep "$PAGE_DELAY"
      local page_url="${listing_url}?page=${page}"

      local status_check
      status_check=$(check_page_status "$page_url")

      if [ "$status_check" = "403" ] || [ "$status_check" = "401" ]; then
        log_warn "Page ${page}: blocked (${status_check}). Pagination blocked by bot protection."
        pagination_blocked=true
        break
      fi

      local page_html
      page_html=$(fetch_page "$page_url")

      if [ -z "$page_html" ]; then
        log_warn "Page ${page}: empty response"
        continue
      fi

      local page_pdfs
      page_pdfs=$(extract_pdfs_from_html "$page_html")
      local page_count
      page_count=$(echo "$page_pdfs" | grep -c '\.pdf' || echo 0)

      if [ "$page_count" -gt 0 ]; then
        echo "$page_pdfs" >> "$urls_file"
        log_ok "Page ${page}/${max_page}: ${page_count} PDFs"
      else
        log_warn "Page ${page}/${max_page}: 0 PDFs found"
      fi
    done
  fi

  if [ "$pagination_blocked" = true ]; then
    log_info "Switching to probe-based discovery..."
    probe_remaining_files "$ds_num" "$urls_file"
  fi

  sort -u "$urls_file" -o "$urls_file"
  sed -i '/^$/d' "$urls_file"

  local total_urls
  total_urls=$(wc -l < "$urls_file" || echo 0)
  log_info "Total unique URLs for Data Set ${ds_num}: ${total_urls}"

  local downloaded=0
  local skipped=0
  local failed=0

  while IFS= read -r pdf_url; do
    [ -z "$pdf_url" ] && continue

    if [ "${pdf_url:0:4}" != "http" ]; then
      pdf_url="https://www.justice.gov${pdf_url}"
    fi

    local filename
    filename=$(basename "$pdf_url" | sed 's/%20/ /g')
    local dest="${ds_dir}/${filename}"

    if [ -f "$dest" ] && [ "$(wc -c < "$dest")" -gt 1000 ]; then
      skipped=$((skipped + 1))
      continue
    fi

    if download_pdf "$pdf_url" "$dest"; then
      downloaded=$((downloaded + 1))
      if [ $((downloaded % 25)) -eq 0 ]; then
        local size
        size=$(wc -c < "$dest" 2>/dev/null || echo 0)
        log_ok "Downloaded ${downloaded}/${total_urls}: ${filename} (${size} bytes)"
      fi
    else
      failed=$((failed + 1))
      log_err "Failed: ${filename}"
    fi

    sleep "$DOWNLOAD_DELAY"
  done < "$urls_file"

  echo ""
  log_ok "Data Set ${ds_num} complete:"
  log_info "  Downloaded: ${downloaded}"
  log_info "  Skipped (existing): ${skipped}"
  if [ $failed -gt 0 ]; then
    log_err "  Failed: ${failed}"
  fi
}

DS_START=${1:-1}
DS_END=${2:-12}

if [ $# -eq 1 ]; then
  DS_END=$DS_START
fi

echo "=============================================="
echo " DOJ Epstein Disclosure Files Downloader"
echo " Data Sets: ${DS_START} through ${DS_END}"
echo " Output: ${DOWNLOAD_DIR}"
echo "=============================================="

for ds in $(seq "$DS_START" "$DS_END"); do
  scrape_data_set "$ds"
done

echo ""
echo "=============================================="
echo " DOWNLOAD COMPLETE"
echo "=============================================="
echo ""

for ds in $(seq "$DS_START" "$DS_END"); do
  local_dir="${DOWNLOAD_DIR}/data-set-${ds}"
  count=$(ls "$local_dir"/*.pdf 2>/dev/null | wc -l || echo 0)
  echo "  Data Set ${ds}: ${count} PDFs"
done

failed_count=$(wc -l < "$FAILED_LOG" 2>/dev/null || echo 0)
if [ "$failed_count" -gt 0 ]; then
  echo ""
  log_err "Failed downloads: ${failed_count} (see ${FAILED_LOG})"
fi
