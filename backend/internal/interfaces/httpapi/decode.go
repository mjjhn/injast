package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"injast/hadaf/internal/domain"
	"io"
	"net/http"
	"unicode/utf8"
)

func decode(w http.ResponseWriter, r *http.Request, value any, allowed ...string) error {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	invalid := func() error { return domain.Validation("", "بدنهٔ درخواست JSON معتبر نیست.") }
	if err != nil || !utf8.Valid(raw) {
		return invalid()
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return invalid()
	}
	fields := make(map[string]json.RawMessage)
	permitted := make(map[string]bool, len(allowed))
	for _, name := range allowed {
		permitted[name] = true
	}
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return invalid()
		}
		name, ok := token.(string)
		if !ok {
			return invalid()
		}
		if !permitted[name] {
			return domain.Validation("", "فیلد ناشناخته در درخواست وجود دارد.")
		}
		if _, exists := fields[name]; exists {
			return domain.Validation(name, "هر فیلد فقط یک بار مجاز است.")
		}
		var field json.RawMessage
		if err = decoder.Decode(&field); err != nil {
			return invalid()
		}
		if bytes.Equal(bytes.TrimSpace(field), []byte("null")) {
			return domain.Validation(name, "مقدار این فیلد نمی‌تواند خالی باشد.")
		}
		fields[name] = field
	}
	if _, err = decoder.Token(); err != nil {
		return invalid()
	}
	var extra json.RawMessage
	if err = decoder.Decode(&extra); err != io.EOF {
		return domain.Validation("", "فقط یک بدنهٔ JSON مجاز است.")
	}
	canonical, err := json.Marshal(fields)
	if err != nil {
		return invalid()
	}
	if err = json.Unmarshal(canonical, value); err != nil {
		var typed *json.UnmarshalTypeError
		if errors.As(err, &typed) {
			return domain.Validation(typed.Field, "نوع مقدار واردشده معتبر نیست.")
		}
		return invalid()
	}
	return nil
}
