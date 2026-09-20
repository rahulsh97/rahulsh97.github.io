# test_atlas.R — validates the built Atlas data against the raw KLEMS workbook.
# Run from the atlas folder:  Rscript build/test_atlas.R [path/to/workbook.xlsx]
suppressWarnings(suppressMessages({ library(readxl); library(jsonlite) }))
args <- commandArgs(trailingOnly = TRUE)
wb <- if (length(args) >= 1) args[1] else
  "C:/Users/SHUKLAR7/AppData/Local/Temp/claude/C--Users-SHUKLAR7-OneDrive---London-School-of-Economics-Desktop-Code/5bf4054e-d4eb-4e59-b82d-439374732264/scratchpad/klems2024.xlsx"

pass <- 0; fail <- 0
ok <- function(cond, msg) { if (isTRUE(cond)) { cat("PASS:", msg, "\n"); pass <<- pass + 1 }
  else { cat("FAIL:", msg, "\n"); fail <<- fail + 1 } }

K <- fromJSON("data/atlas_klems.json", simplifyDataFrame = FALSE)
ind <- K$industries; yrs <- unlist(K$years)
ok(length(ind) == 27, "India JSON has 27 industries")
ok(length(yrs) == 43 && yrs[1] == "1980-81" && yrs[43] == "2022-23", "years 1980-81..2022-23")
is_mfg <- vapply(ind, function(z) isTRUE(z$is_mfg), logical(1))
ok(sum(is_mfg) == 13, "manufacturing = 13 industries")

getv <- function(z, f) unlist(z[[f]])
# units / ranges
allL <- do.call(c, lapply(ind, function(z) getv(z, "lsh_va")))
allP <- do.call(c, lapply(ind, function(z) getv(z, "lp")))
ok(all(allL >= 0 & allL <= 1), "lsh_va in [0,1]")
ok(all(allP > 0), "LP strictly positive")
ok(!any(is.na(do.call(c, lapply(ind, function(z) c(getv(z,"va_nom"),getv(z,"lsh_va"),getv(z,"lp"),getv(z,"emp")))))),
   "no missing cells (KLEMS complete; app shows 'no observations' only for empty OECD selections)")

# aggregate share + decomposition (recomputed from JSON)
mfgi <- ind[is_mfg]
share <- function(j) { w <- vapply(mfgi, function(z) getv(z,"va_nom")[j], numeric(1))
  s <- vapply(mfgi, function(z) getv(z,"lsh_va")[j], numeric(1)); sum(w*s)/sum(w) }
j0 <- match("2011-12", yrs); j1 <- match("2022-23", yrs)
w0 <- vapply(mfgi,function(z)getv(z,"va_nom")[j0],numeric(1)); w0 <- w0/sum(w0)
w1 <- vapply(mfgi,function(z)getv(z,"va_nom")[j1],numeric(1)); w1 <- w1/sum(w1)
s0 <- vapply(mfgi,function(z)getv(z,"lsh_va")[j0],numeric(1)); s1 <- vapply(mfgi,function(z)getv(z,"lsh_va")[j1],numeric(1))
within <- sum(((w0+w1)/2)*(s1-s0)); between <- sum(((s0+s1)/2)*(w1-w0))
dS <- share(j1) - share(j0)

# ---- THREE INDEPENDENTLY RECALCULATED ANCHORS ----
A1 <- share(j0); A2 <- share(j1); A3 <- within
cat(sprintf("\nANCHORS: (1) 2011-12 share=%.4f  (2) 2022-23 share=%.4f  (3) within=%.4f  [between=%.4f]\n\n", A1,A2,A3,between))
ok(abs(A1 - 0.2930) < 0.001, "anchor 1: 2011-12 mfg share ~= 29.30%")
ok(abs(A2 - 0.3255) < 0.001, "anchor 2: 2022-23 mfg share ~= 32.55%")
ok(abs(A3 - 0.0337) < 0.001, "anchor 3: within-industry ~= +3.37pp")
ok(abs((within + between) - dS) < 1e-12, "decomposition identity: within+between == dS (to 1e-12)")
ok(abs(between - (-0.0011)) < 0.001, "cross-check: composition ~= -0.11pp")

# selected-industry contributions sum to dS
contrib <- ((w0+w1)/2)*(s1-s0) + ((s0+s1)/2)*(w1-w0)
ok(abs(sum(contrib) - dS) < 1e-12, "signed industry contributions sum to aggregate change")

# ---- SPOT-CHECK raw workbook cells vs JSON ----
read_var <- function(sh){x<-suppressMessages(read_excel(wb,sheet=sh,col_names=FALSE,.name_repair="minimal"));d<-as.data.frame(x);yy<-as.character(unlist(d[2,4:ncol(d)]));b<-d[3:nrow(d),];b<-b[!is.na(b[[1]]),];list(code=as.character(b[[2]]),years=yy,vals=as.matrix(sapply(b[,4:ncol(b)],as.numeric)))}
rawLP <- read_var("LP"); rawLSH <- read_var("LSH_va"); rawVA <- read_var("VA_r")
cellchk <- function(raw, code, year, jsonfield) {
  ri <- which(raw$code==code); ci <- match(year, raw$years)
  zi <- which(vapply(ind, function(z) z$code==code, logical(1)))
  jj <- match(year, yrs)
  abs(raw$vals[ri,ci] - getv(ind[[zi]], jsonfield)[jj]) < 1e-3 + abs(raw$vals[ri,ci])*1e-6
}
ok(cellchk(rawLP, "17t19","2022-23","lp"),   "spot-check LP Textiles 2022-23 matches workbook")
ok(cellchk(rawLSH,"15t16","2022-23","lsh_va"),"spot-check LSH_va Food 2022-23 matches workbook")
ok(cellchk(rawVA, "24","1980-81","va_real"),  "spot-check VA_r Chemicals 1980-81 matches workbook")

# ---- OECD plane structure ----
O <- fromJSON("data/atlas_oecd.json", simplifyDataFrame = FALSE)
sh_all <- do.call(c, lapply(O$series, function(s) c(unlist(s$comp_share), unlist(s$wage_share))))
sh_all <- sh_all[!is.na(sh_all)]
ok(length(O$series) > 0 && length(O$countries) >= 5, "OECD plane has countries and series")
ok(all(sh_all > 0 & sh_all < 1.5), "OECD shares are plausible ratios (0,1.5) after suppressing negative-VA years")
ok(all(unlist(lapply(O$series, function(s) length(s$year)==length(s$comp_share)))), "OECD year/share arrays aligned")

cat(sprintf("\n==== %d passed, %d failed ====\n", pass, fail))
if (fail > 0) quit(status = 1)
