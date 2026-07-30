# econcile

Cloudflare Workers + Static Assets + D1 的銀行對帳與電子帳單系統。

## 已包含功能

- 客戶表匯入（`.xls`、`.xlsx`、`.csv`）
- 國泰世華 CSR530 自動辨識
- 繳款人代號／虛擬帳號入帳比對
- 已入帳、未繳、已繳未入帳、部分繳款、溢繳與未匹配狀態
- CRM 預留 LINE UID
- 電子帳單與三段式 Code 39 SVG 條碼
- 條碼文字複製、手機顯示與列印／儲存 PDF
- 管理密碼保護（Cloudflare Secret）

## 超商條碼測試規格

目前依現有紙本帳單反推：

- 第一段：`4912316R7`
- 第二段：`00` + 14 碼虛擬帳號
- 第三段：`1231` + 兩碼校對碼 + 9 碼金額
- 條碼：Code 39

照片範例：

```text
虛擬帳號：15030950700056
金額：3600

第一段：4912316R7
第二段：0015030950700056
第三段：123156000003600
```

正式發送前，必須先以 3 至 5 筆到超商測試讀取，並向銀行確認代收代碼及長效期限。

## 本機安裝

```bash
npm install
npm run check
```

## Cloudflare 設定

1. 建立 D1：

   ```bash
   npx wrangler d1 create reconcile-db
   ```

2. 將回傳的 `database_id` 填入 `wrangler.jsonc`。

3. 套用資料庫：

   ```bash
   npm run db:migrate:remote
   ```

4. 設定管理密碼：

   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   ```

5. 部署：

   ```bash
   npm run deploy
   ```

## 安全提醒

正式環境必須設定 `ADMIN_PASSWORD`，或在 Cloudflare Zero Trust 設定 Access。
請勿在未保護狀態下公開客戶姓名、電話、地址、帳單及虛擬帳號。
