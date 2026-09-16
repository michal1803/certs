# Exam Hub — GitHub Pages

Gotowy statyczny projekt z dwoma egzaminami:

- `index.html` — ekran wyboru egzaminu
- `terraform.html` — HashiCorp Terraform Associate 004
- `az104.html` — Microsoft AZ-104
- `.nojekyll` — wyłącza przetwarzanie Jekyll

## Publikacja na GitHub Pages

1. Utwórz nowe repozytorium na GitHub.
2. Wgraj zawartość tego folderu do głównego katalogu repozytorium.
3. Wejdź w **Settings → Pages**.
4. W **Build and deployment** wybierz **Deploy from a branch**.
5. Wybierz branch **main** i katalog **/(root)**.
6. Zapisz ustawienia.

Po wdrożeniu strona będzie dostępna pod adresem w formacie:
`https://TWOJ-LOGIN.github.io/NAZWA-REPO/`

## Co zostało dodane

- wspólny ekran startowy z wyborem egzaminu,
- przycisk powrotu do listy egzaminów,
- zapis postępu w `localStorage`,
- odtwarzanie zaznaczonych/udzielonych odpowiedzi po odświeżeniu,
- prostsze podpowiedzi w wyszukiwarce,
- układ responsywny dla telefonu i komputera.

## Ważne

Część obrazów w AZ-104 jest nadal pobierana z zewnętrznych adresów wskazanych w oryginalnym HTML.
Jeśli zewnętrzne źródło przestanie je udostępniać, obraz może przestać się wyświetlać.

`localStorage` działa per przeglądarka/urządzenie. Nie synchronizuje postępu między urządzeniami.
