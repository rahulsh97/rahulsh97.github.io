# build_atlas.R — deterministic offline extraction for the Industry Productivity
# & Pay Atlas (India core). Reads the RBI India KLEMS workbook and writes the
# aggregate industry-year series the static web app consumes. No values are
# hard-coded; everything is recomputed from the workbook.
#
# Source (pinned): RBI India KLEMS, release July 2024, file INDIAKLEMS08072024.xlsx
#   sha256 = acccbe7a59529ac76db584357591b5ded96d2f5b8b291e455394785fd0b0463a
#   Coverage: 27 industries, 1980-81..2022-23; manufacturing = 13 (SL 3-15);
#   constant prices base 2011-12. The raw workbook is NOT redistributed here
#   (cite/download from RBI, https://m.rbi.org.in/Scripts/PublicationReportDetails.aspx?ID=1275).
#
# Usage:  Rscript build_atlas.R  /path/to/INDIAKLEMS08072024.xlsx
#   (defaults to the workspace scratchpad copy if no path given)

suppressWarnings(suppressMessages({ library(readxl); library(jsonlite) }))

args <- commandArgs(trailingOnly = TRUE)
default_wb <- "C:/Users/SHUKLAR7/AppData/Local/Temp/claude/C--Users-SHUKLAR7-OneDrive---London-School-of-Economics-Desktop-Code/5bf4054e-d4eb-4e59-b82d-439374732264/scratchpad/klems2024.xlsx"
wb <- if (length(args) >= 1) args[1] else default_wb
stopifnot(file.exists(wb))

PIN_SHA256 <- "acccbe7a59529ac76db584357591b5ded96d2f5b8b291e455394785fd0b0463a"

read_var <- function(sh) {
  x <- suppressMessages(read_excel(wb, sheet = sh, col_names = FALSE, .name_repair = "minimal"))
  d <- as.data.frame(x)
  yrs <- as.character(unlist(d[2, 4:ncol(d)]))
  b <- d[3:nrow(d), , drop = FALSE]
  b <- b[!is.na(b[[1]]), , drop = FALSE]
  list(sl = suppressWarnings(as.integer(b[[1]])), code = as.character(b[[2]]),
       desc = as.character(b[[3]]), years = yrs,
       vals = as.matrix(sapply(b[, 4:ncol(b)], as.numeric)))
}

VA  <- read_var("VA")      # Value Added at current prices (Rs Crore)
VAr <- read_var("VA_r")    # Value Added at constant 2011-12 prices (Rs Crore)
LP  <- read_var("LP")      # Labour productivity (real VA per person, '000 Rs, 2011-12)
LSH <- read_var("LSH_va")  # Labour income share in value added (ratio)
EMP <- read_var("EMP")     # Persons employed ('000)

stopifnot(identical(VA$years, VAr$years), identical(VA$years, LP$years),
          identical(VA$years, LSH$years), identical(VA$years, EMP$years))
# Normalise stray double-hyphen year labels from the workbook (e.g. "1997--98"
# -> "1997-98"). Display labels only; no economic values are touched.
years <- gsub("-{2,}", "-", VA$years)
n <- length(VA$code)
stopifnot(n == 27L, length(years) == 43L, !any(grepl("--", years)))

industries <- lapply(seq_len(n), function(i) {
  list(
    sl      = VA$sl[i],
    code    = VA$code[i],
    name    = VA$desc[i],
    is_mfg  = isTRUE(VA$sl[i] >= 3 && VA$sl[i] <= 15),   # KLEMS manufacturing = SL 3-15
    va_nom  = round(as.numeric(VA$vals[i, ]), 3),
    va_real = round(as.numeric(VAr$vals[i, ]), 3),
    lp      = round(as.numeric(LP$vals[i, ]), 3),
    lsh_va  = round(as.numeric(LSH$vals[i, ]), 6),
    emp     = round(as.numeric(EMP$vals[i, ]), 3)
  )
})

meta <- list(
  title = "Industry Productivity & Pay Atlas — India core",
  source = "RBI India KLEMS database, release July 2024",
  source_file = "INDIAKLEMS08072024.xlsx",
  source_sha256 = PIN_SHA256,
  release_url = "https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=58246",
  manual_url = "https://m.rbi.org.in/Scripts/PublicationReportDetails.aspx?ID=1275&UrlPage=",
  vintage_note = paste("Single release used (no vintage splicing). The workbook Info sheet self-labels",
                       "'database 2023'; the file is the July 2024 release covering to 2022-23."),
  base_year = "2011-12 (constant prices)",
  coverage = "27 industries, 1980-81 to 2022-23; manufacturing = 13 industries (SL 3-15).",
  units = list(
    va_nom = "Rs crore, current (nominal) prices",
    va_real = "Rs crore, constant 2011-12 prices",
    lp = "'000 Rs per person employed, constant 2011-12 prices (real value added per person)",
    lsh_va = "ratio: labour income / value added (broad labour income, incl. imputed self-employed labour)",
    emp = "persons employed ('000)"
  ),
  definitions = list(
    labour_income = paste("RBI KLEMS labour income = compensation of employees PLUS the labour part of",
                          "self-employed mixed income (imputed via a Heckman-corrected Mincer wage equation).",
                          "This is a BROAD labour-income measure, NOT ASI wages paid to formal workers."),
    lsh_times_lp = paste("If shown, LSH_va x LP = labour income per worker in constant 2011-12",
                         "VALUE-ADDED prices; it is NOT a consumption-deflated wage.")
  ),
  licence = paste("Derived aggregate series from RBI India KLEMS, shown with attribution for research.",
                  "Cite RBI India KLEMS (2024). The raw workbook is not redistributed here."),
  descriptive_note = "The within/composition split is an accounting identity, not a causal explanation.",
  generated = format(Sys.time(), "%Y-%m-%d")
)

out <- list(meta = meta, years = years, industries = industries)
dir.create("data", showWarnings = FALSE)
write_json(out, "data/atlas_klems.json", auto_unbox = TRUE, digits = 8, pretty = FALSE)
cat("Wrote data/atlas_klems.json:", n, "industries x", length(years), "years\n")

# ---- Validation (printed; also see build/test_atlas.R) ----------------------
mfg <- which(vapply(industries, function(z) z$is_mfg, logical(1)))
S <- function(iy) {
  w <- vapply(mfg, function(k) industries[[k]]$va_nom[iy], numeric(1))
  s <- vapply(mfg, function(k) industries[[k]]$lsh_va[iy], numeric(1))
  sum(w * s) / sum(w)
}
i0 <- match("2011-12", years); i1 <- match("2022-23", years)
w0 <- vapply(mfg, function(k) industries[[k]]$va_nom[i0], numeric(1)); w0 <- w0/sum(w0)
w1 <- vapply(mfg, function(k) industries[[k]]$va_nom[i1], numeric(1)); w1 <- w1/sum(w1)
s0 <- vapply(mfg, function(k) industries[[k]]$lsh_va[i0], numeric(1))
s1 <- vapply(mfg, function(k) industries[[k]]$lsh_va[i1], numeric(1))
within  <- sum(((w0+w1)/2) * (s1-s0))
between <- sum(((s0+s1)/2) * (w1-w0))
cat(sprintf("ANCHOR mfg labour-income share: %.4f (2011-12) -> %.4f (2022-23); dS=%+.4f\n", S(i0), S(i1), S(i1)-S(i0)))
cat(sprintf("  within=%+.4f  between=%+.4f  sum=%+.4f  identity residual=%.2e\n",
            within, between, within+between, (within+between)-(S(i1)-S(i0))))
cat(sprintf("  (cross-check vs prior: ~29.3%%->32.6%%, within ~+3.37pp, comp ~-0.11pp)\n"))
