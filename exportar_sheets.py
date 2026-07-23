from datetime import datetime
from pathlib import Path
import os
import sys
import ssl
import pandas as pd
import requests

# Bypassear verificación SSL para entornos locales
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
ssl._create_default_https_context = ssl._create_unverified_context
os.environ['PYTHONHTTPSVERIFY'] = '0'

# Patch global para requests
old_request = requests.Session.request
def new_request(*args, **kwargs):
    kwargs['verify'] = False
    return old_request(*args, **kwargs)
requests.Session.request = new_request

# ---------------------------------------------------------
# VALIDACIÓN DE DEPENDENCIAS
# ---------------------------------------------------------
try:
    import gspread
    import yfinance as yf
    from google.oauth2.service_account import Credentials
    from google.auth.transport.requests import AuthorizedSession
except ImportError:
    print(
        "\n[!] Falta alguna dependencia requerida.\n"
        "    Ejecuta: python -m pip install gspread google-auth yfinance pandas requests\n"
    )
    sys.exit(1)

# ---------------------------------------------------------
# CONFIGURACIÓN
# ---------------------------------------------------------
SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1dJZCNH2cc_t4JUvhIwmx3RDvH2fmzOL3ZPhCRcsnnvk/edit"
CREDENTIALS_FILE = Path("credentials.json")
START_DATE = "2018-01-01"

TICKERS = [
    # Megacaps / Tech Leaders
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA", "AVGO",
    # Semiconductors & Hardware
    "AMD", "ARM", "ASML", "MU", "SMCI", "LRCX", "KLAC", "QCOM",
    # Software, Cloud & Cybersecurity
    "PANW", "CRWD", "PLTR", "DDOG", "NET", "SNOW", "MDB", "ZS", "NOW", "ORCL",
    # Fintech & High-Growth E-commerce
    "SHOP", "MELI", "SE", "SQ", "PYPL", "NU", "COIN",
    # Healthcare & Biotech
    "LLY", "NVO", "ISR", "VRTX"
]


def ejecutar_etl_identico_flet():
    print(f"\n[ETL Flet] Escaneando {len(TICKERS)} activos con formato de punto decimal...")
    rows = []

    for ticker in TICKERS:
        try:
            tk = yf.Ticker(ticker)
            hist = tk.history(start=START_DATE, auto_adjust=True)

            if hist.empty or len(hist) < 20:
                continue

            hist = hist.reset_index()
            info = tk.info or {}
            last_close = float(hist["Close"].iloc[-1])

            ema_20 = float(hist["Close"].ewm(span=20, adjust=False).mean().iloc[-1]) if len(hist) >= 20 else None
            sma_50 = float(hist["Close"].rolling(50).mean().iloc[-1]) if len(hist) >= 50 else None
            sma_200 = float(hist["Close"].rolling(200).mean().iloc[-1]) if len(hist) >= 200 else None
            ret_1y = float(hist["Close"].iloc[-1] / hist["Close"].iloc[-252] - 1) if len(hist) >= 252 else None

            rows.append({
                "Ticker": ticker,
                "Sector": info.get("sector", "N/A"),
                "RevenueGrowth_YoY": info.get("revenueGrowth", 0.0) or 0.0,
                "LastClose": last_close,
                "EMA20": ema_20,
                "SMA50": sma_50,
                "SMA200": sma_200,
                "Return1Y": ret_1y,
                "BullTrend": bool(last_close > sma_200) if sma_200 else False
            })
            print(f"  [+] {ticker} procesado con éxito.")

        except Exception as err:
            print(f"  [!] Error procesando {ticker}: {err}")

    fund_df = pd.DataFrame(rows)

    # Filtro idéntico a Flet
    filtered_df = fund_df[
        (fund_df["BullTrend"] == True) &
        (fund_df["RevenueGrowth_YoY"].fillna(0) > 0.15) &
        (fund_df["Return1Y"].fillna(-999) > 0)
    ].copy()

    senales = []
    for _, row in filtered_df.iterrows():
        close, ema20, sma50 = row["LastClose"], row["EMA20"], row["SMA50"]

        if not ema20 or not sma50:
            continue

        dist_ema20 = ((close - ema20) / ema20) * 100
        dist_sma50 = ((close - sma50) / sma50) * 100

        if -1.5 <= dist_ema20 <= 0.5 and dist_sma50 > 0:
            estado = "🎯 ENTRADA IDEAL"
        elif 0.5 < dist_ema20 <= 2.0 and dist_sma50 > 0:
            estado = "🚀 REBOTE / MOMENTUM"
        elif dist_ema20 > 5.0:
            estado = "⚠️ SOBREEXTENDIDO"
        elif dist_ema20 < -2.0:
            estado = "🔍 SOPORTE SMA50"
        else:
            estado = "⌛ EN ESPERA"

        senales.append({
            "Ticker": str(row["Ticker"]),
            "Sector": str(row["Sector"]),
            "Precio": f"{close:.2f}",
            "EMA20": f"{ema20:.2f}",
            "Dist_EMA20": f"{dist_ema20:.2f}",
            "Dist_SMA50": f"{dist_sma50:.2f}",
            "Ventas_YoY": f"{((row['RevenueGrowth_YoY'] or 0) * 100):.1f}",
            "Estado": str(estado),
            "AbsDist": abs(dist_ema20)
        })

    df_res = pd.DataFrame(senales)
    if not df_res.empty:
        df_res = df_res.sort_values(by="AbsDist")

    cols_export = ["Ticker", "Sector", "Precio", "EMA20", "Dist_EMA20", "Dist_SMA50", "Ventas_YoY", "Estado"]
    df_pwa_final = df_res[cols_export] if not df_res.empty else pd.DataFrame(columns=cols_export)

    if CREDENTIALS_FILE.exists():
        try:
            scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
            creds = Credentials.from_service_account_file(str(CREDENTIALS_FILE), scopes=scopes)
            authed_session = AuthorizedSession(creds)
            authed_session.verify = False
            client = gspread.Client(auth=creds, session=authed_session)

            doc = client.open_by_url(SPREADSHEET_URL)
            try:
                sheet_pwa = doc.worksheet("PWA_Export")
            except Exception:
                sheet_pwa = doc.add_worksheet(title="PWA_Export", rows=100, cols=20)

            sheet_pwa.clear()
            sheet_pwa.update([df_pwa_final.columns.values.tolist()] + df_pwa_final.values.tolist())
            print(f"\n[✅] Pestaña 'PWA_Export' actualizada correctamente ({len(df_pwa_final)} activos).\n")

        except Exception as e:
            print(f"[!] Error enviando a Google Sheets: {e}")

if __name__ == "__main__":
    ejecutar_etl_identico_flet()