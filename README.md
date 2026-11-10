# هدف — مینی‌اپ پس‌انداز

پیاده‌سازی تسک با **Go/Gin، SQLite و React/TypeScript**. کاربر هدف می‌سازد، به آن پول
اضافه می‌کند و هدف فعال را با تأیید لغو می‌کند. رابط فارسی و RTL است؛ مبالغ در UI
و API **ریال** هستند. تقویم رابط شمسی و تاریخ API به‌شکل میلادی `YYYY-MM-DD` است.

[BRIEF.md](BRIEF.md) و [check_api.py](check_api.py) فایل‌های اصلی تسک‌اند و بدون تغییر
حفظ شده‌اند. دادهٔ برنامه از API می‌آید؛ fixture فقط در تست استفاده می‌شود.

## اجرای سریع

پیش‌نیازها: **Go 1.27+، Node.js 26+، npm 9+، Python 3.10+ و Make**.
نسخه‌های بررسی‌شده روی Linux: Go 1.27.3، Node 26.8.1 و npm 9.2.0.
SQLite داخل برنامه است؛ DB server، Docker، CGO و فایل `.env` برای اجرای عادی لازم نیستند.

از ریشهٔ ریپو:

```bash
make install
```

ترمینال اول:

```bash
make api
```

ترمینال دوم:

```bash
make ui
```

| بخش | نشانی |
| --- | --- |
| رابط | http://127.0.0.1:5173/ |
| API | http://127.0.0.1:4000/api |
| health و metrics محلی | http://127.0.0.1:4001/health/ready |

UI و API **دو پروسهٔ جدا** هستند. مرورگر مستقیماً به API درخواست می‌زند؛ Vite proxy
در کار نیست. listener عملیاتی ۴۰۰۱ داخل همان پروسهٔ Go است. برای خروج `Ctrl+C` بزنید.

معادل بدون Make، در دو ترمینال:

```bash
cd backend
go mod download
go run -buildvcs=false ./cmd/api
```

```bash
cd frontend
npm ci
npm run dev
```

برای build: `make build`. باینری در `backend/bin/api` و خروجی UI در `frontend/dist`
ساخته می‌شوند. `npm run preview` در `frontend/` خروجی build را روی ۵۱۷۳ نمایش می‌دهد؛
API باید جداگانه روشن باشد. فایل‌های `.env.example` صرفاً نمونه‌اند؛ API dotenv بارگذاری نمی‌کند.

## داده و تنظیمات

با `make api`، داده در `backend/data/hadaf.db` نگهداری می‌شود. نخستین اجرا موجودی
۲۵٬۰۰۰٬۰۰۰ ریال و سه هدف brief را می‌سازد. **restart داده یا کلیدهای واریز را پاک نمی‌کند.**
مبالغ ذخیره‌شدهٔ اولیه جدا از موجودی قابل‌استفاده‌اند.

| متغیر | پیش‌فرض / کاربرد |
| --- | --- |
| `API_ADDR` | `127.0.0.1:4000` |
| `DB_PATH` | `data/hadaf.db` نسبت به working directory پروسهٔ API |
| `CORS_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` |
| `OPS_ADDR` | `127.0.0.1:4001`؛ فقط loopback، یا `off` |
| `LOG_LEVEL` | `info`؛ گزینه‌ها: `debug/info/warn/error` |
| `VITE_API_URL` | `http://127.0.0.1:4000`؛ هنگام اجرای Vite/build خوانده می‌شود |

CORS هدرهای `Content-Type`، `Idempotency-Key` و `X-Request-ID` را می‌پذیرد و request ID
پاسخ را در دسترس مرورگر می‌گذارد. برای پورت‌های متفاوت، origin و آدرس API را در هر دو طرف تنظیم کنید.

`POST /api/reset` داده و کلیدها را به seed بازمی‌گرداند و صرفاً بخشی از قرارداد تمرین است.
checker را به دیتابیس دارای دادهٔ موردنیاز خود متصل نکنید. schema نسخهٔ۱ به۲ اتمیک مهاجرت
می‌کند؛ داده و پاسخ‌های idempotency حفظ می‌شوند. نسخهٔ schema ناشناخته قبل از تنظیم WAL رد می‌شود.
برای backup در اجرای دارای داده از SQLite backup API استفاده کنید؛ کپی تنها فایل DB هنگام WAL کافی نیست.

## ساختار و تصمیم‌ها

```text
backend/
  cmd/api/                       تنظیمات و اتصال وابستگی‌ها
  internal/domain/               مدل‌ها، اعتبارسنجی و قواعد هدف/پول
  internal/application/          use caseها، repository interfaces و Unit of Work
  internal/interfaces/httpapi/   Gin، DTO، parser و نگاشت خطاهای HTTP
  internal/infrastructure/       SQLite، migration و observability
  internal/bootstrap/            startup، listenerها و shutdown
frontend/
  src/design-system/             tokenها، کنترل‌ها، تقویم و Modal
  src/features/                  صفحات، queryها و منطق واریز/لغو
  src/lib/                       پول، تاریخ و اعتبارسنجی رابط
  e2e/                           جریان‌های مرورگر و قرارداد ظاهر
scripts/                         پذیرش فرایندی، checker و clean-copy
```

- **مرزهای بک‌اند:** domain از HTTP/SQL مستقل است؛ application به interfaceهای کوچک وابسته
  است و repositoryهای متصل به یک transaction را از Unit of Work می‌گیرد. Gin و SQLite adapter هستند.
- **صحت پول:** مبالغ `int64` ریال‌اند. `BEGIN IMMEDIATE`، کسر wallet، افزایش پس‌انداز، تکمیل
  هدف و ذخیرهٔ نتیجهٔ idempotency را در یک commit نگه می‌دارد. خطای قانون مالی تغییری باقی نمی‌گذارد.
- **Idempotency:** کلید در کل برنامه یکتا است؛ همان هدف/مبلغ پاسخ اولیه را حتی بعد از تکمیل، حذف
  یا restart برمی‌گرداند. payload متفاوت conflict است؛ فقط نتیجهٔ موفق کلید را رزرو می‌کند.
  lookup خواندنی با بررسی دوباره داخل تراکنش همراه است تا race بسته شود.
- **SQLite:** WAL، یک connection نویسنده و حداکثر چهار connection خواندن؛ replay تأییدشده
  به گرفتن قفل نویسنده نیاز ندارد. لغو و واریز سریال می‌شوند؛ refund فقط یک‌بار انجام می‌شود.
- **ورودی و زمان:** parser سخت‌گیرانه JSON تکراری/unknown/null، اعشار، overflow و بدنهٔ بیش از
  ۱ MiB را رد می‌کند. امروز سرور `Asia/Tehran` و timestampها UTC هستند؛ clock/ID در تست تزریق می‌شوند.
  سقف۲۴ماه با ماه تقویمی میلادی و clamp روز پایان ماه محاسبه می‌شود؛ دو حد تاریخ شامل‌اند.
- **فرانت:** React Router، TanStack Query، Radix و CSS ساده. توکن‌های فاصله روی شبکهٔ۴ و radius۱۲؛
  قاب حداکثر۳۶۰، حاشیه۱۶، Vazirmatn محلی و Lucide. منطق مالی نهایی روی سرور است.
- **پاسخ نامعلوم:** واریز key/payload را در `sessionStorage` نگه می‌دارد؛ retry همان تلاش است.
  پس از موفقیت، دادهٔ تازه خوانده می‌شود و snapshot تاریخی replay روی وضعیت جدید نوشته نمی‌شود.
  لغو نامعلوم با GET هدف/wallet/فهرست‌ها بررسی می‌شود؛ «بررسی نتیجه» لغو را خودکار تکرار نمی‌کند.
  ساخت نامعلوم فرم را حفظ و مسیر بررسی فهرست ارائه می‌کند؛ exactly-once ساخت به قرارداد اضافه نشده است.

## API

قرارداد دقیق body، response و خطاها در [BRIEF.md](BRIEF.md) است:

| روش | مسیر |
| --- | --- |
| POST | `/api/reset` |
| GET | `/api/wallet` |
| GET | `/api/goals?status=active\|completed` |
| GET | `/api/goals/{id}` |
| POST | `/api/goals` |
| POST | `/api/goals/{id}/deposits` با `Idempotency-Key` |
| POST | `/api/goals/{id}/cancel` |

```bash
curl http://127.0.0.1:4000/api/wallet
curl 'http://127.0.0.1:4000/api/goals?status=active'
```

## آزمون‌ها

```bash
make test          # unit فرانت و Go، integration ذخیره‌سازی/HTTP/رقابت
make race          # Go race detector؛ toolchain دارای پشتیبانی race لازم است
make lint          # go vet و ESLint
make typecheck
make build
make coverage
make fuzz          # fuzz محدودِ قواعد پول و JSON
make benchmark
make restart       # SIGKILL/restart/replay و SIGTERM با درخواست جاری
make startup       # شش startup ناموفق + اجرای سالم و SIGTERM با باینری واقعی
make verify-inputs # hash فایل‌های اصلی تسک
```

قانون واریز علاوه بر checker، در تست‌های domain/application و SQLite/HTTP بررسی می‌شود:
مبلغ نامعتبر، موجودی ناکافی، بیش‌ازهدف، تکمیل، rollback، replay، payload conflict و حفظ مجموع پول.
ماتریس integration شامل دو store و دو فرایند مستقل، پنج نوع رقابت و پنج تکرار است.

برای مرورگر، یک‌بار Chromium را نصب کنید:

```bash
cd frontend
npx playwright install --with-deps chromium
cd ..
make e2e
```

E2E یک API و DB موقت و پورت‌های آزاد می‌سازد؛ دادهٔ توسعه را reset نمی‌کند. سناریوها شامل
ساخت/واریز/تکمیل، لغو با تأیید، پاسخ گم‌شده، retry/reload، خطا و حالت خالی، focus/کیبورد،
تقویم، متن۲۰۰٪ و پنج viewport از۳۲۰ تا دسکتاپ‌اند. fixtureهای تست نیز جداگانه قرارداد UI را می‌سنجند.
اگر Chromium قبلاً نصب شده، `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome make e2e` قابل استفاده است.

**checker اصلی داده را reset می‌کند.** برای اجرای مستقیمِ خواسته‌شده در brief، API را روی۴۰۰۰
با یک DB آزمایشی روشن کنید، سپس از ریشه:

```bash
python3 check_api.py
```

یا با پورت۴۰۰۰ آزاد، `make checker` همان checker بدون تغییر را روی API/DB موقت اجرا می‌کند.
اگر پورت اشغال باشد عمداً متوقف می‌شود. `make verify` همهٔ بررسی‌ها را اجرا می‌کند و برای checker
به پورت۴۰۰۰ آزاد نیاز دارد. خروجی آزمون‌ها در `artifacts/` و گزارش Playwright در `frontend/` تولید می‌شود؛
خروجی‌ها، DB و وابستگی‌های نصب‌شده وارد Git نمی‌شوند.

`make clean-check` نصب، تست و build را در یک کپی source تازه با cache/toolchain میزبان بررسی می‌کند؛
معادل ماشین/VM تازه نیست. workflow GitHub همین بررسی‌ها را اجرا و شواهد را artifact می‌کند.

### نتیجهٔ پذیرش محلی نسخهٔ تحویل

در ۲۰۲۶-۱۱-۱۰، `make verify` روی همین بستهٔ source موفق شد: تست‌های Go، race، vet،
coverage، fuzz، restart و startup؛ **۷۲ تست واحد/کامپوننت فرانت و۳۴ سناریوی مرورگر**،
typecheck، lint و build. checker اصلی **۲۴ PASS / صفر FAIL** داشت. برای حفظ API توسعهٔ
میزبان، checker با پورت۴۰۰۰ در namespace شبکهٔ مستقل و DB موقت اجرا شد.
`make clean-check` و `make benchmark` نیز موفق شدند. این‌ها شواهد محلی‌اند؛ وضعیت اجرای
آنلاین workflow در تب Actions ریپو قابل بررسی است.

## لاگ و عملیات

`slog` لاگ JSON با زمان UTC می‌نویسد: request ID، route pattern، status، مدت و دستهٔ خطا.
body، نام هدف، مبلغ، query، SQL، مسیر DB و کلید خام لاگ نمی‌شوند. خطای storage با مرحله/دسته
و کد driver تشخیص داده و یک‌بار شمرده می‌شود؛ لاگ جای ledger حسابداری نیست.

```bash
curl -i http://127.0.0.1:4001/health/live
curl -i http://127.0.0.1:4001/health/ready
curl http://127.0.0.1:4001/metrics
```

readiness، اتصال DB و draining را می‌سنجد. metrics شامل درخواست/latency، نتیجهٔ عملیات،
خطای storage و poolهای DB و Go/process است؛ ID/key وارد label نمی‌شود. Prometheus/Grafana لازم نیستند.
deadline درخواست۵ثانیه، busy timeout یک‌ثانیه و shutdown تا۱۰ثانیه است.

## محدوده و زمان

طبق brief، لاگین، قسط، سود، درگاه، dark mode، چندزبانه، سایدبار ادمین، تب‌بار سراسری و
انیمیشن تزئینی پیاده نشده‌اند. `monthly` فقط برچسب برنامهٔ کاربر است؛ برداشت زمان‌بندی‌شده ندارد.
این تمرین تک‌کاربره است؛ auth، ledger بانکی و deployment تولیدی در محدوده نیستند.

پیاده‌سازی اولیه در یک شب انجام شد؛ بازبینی‌ها و اصلاحات در روز بعد ادامه یافتند.
زمان اضافه صرف صحت تراکنش/replay، رقابت چندفرایندی، بازیابی پاسخ نامعلوم، دسترس‌پذیری
و تطبیق ظاهر شد. زمان‌سنجی ساعتی دقیق ثبت نشده است.

بستن کامل تب یا پاک‌کردن `sessionStorage`، بازیابی تلاش واریز نامعلوم را تضمین نمی‌کند.
ساعت دستگاه برای راهنمای تاریخ UI استفاده می‌شود و سرور مرجع نهایی است. آزمون دستگاه
فیزیکی/iOS و نصب روی سیستم‌عامل دیگر ادعا نشده است. محدودیت شبکهٔ محلی Go در صورت نیاز
با `GOPROXY=https://goproxy.io make install` قابل دورزدن است؛ checksum غیرفعال نمی‌شود.
