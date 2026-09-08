# Legacy Taiken dry-run audit

Generated: 2026-09-08T09:02:44.827Z. Database snapshot: 2026-09-08T09:02:43.567512+00:00 (live read-only transaction).

**No database writes, staging writes, production import, deployment or push were performed by this command.**

Source: students-legacy.xlsm; SHA-256: `d64f7e872667f42b212f9aa11f7b16954884443fc6c4f238361b355478d07cd3`; worksheet: Taiken only; dimension: A1:AT109.

Target: Bee School HQ (9eac4a68-fdd0-4d47-8a9d-ea91ce6f6684) / Ohashi (f8abe682-dfba-47d9-a624-bcc18b0e427f). Current target-school Students: 257.

## Counts

| Measure | Count |
| --- | --- |
| total_physical_rows_including_header | 109 |
| total_taiken_data_rows | 108 |
| genuine_data_rows | 108 |
| excluded_legend_rows | 0 |
| existing_students_in_target_school | 257 |
| dates_populated | 95 |
| trial_dates_parsed | 89 |
| times_populated | 86 |
| trial_times_parsed | 80 |
| rows_with_multiple_explicit_participants | 2 |
| rows_with_multiple_participant_evidence | 6 |
| explicit_participant_rows | 15 |
| invalid_email_rows | 0 |
| invalid_phone_rows | 10 |
| joined_candidates | 18 |
| confirmed_joined_rows | 15 |
| joined_exact_student_match | 5 |
| joined_ambiguous_student_match | 11 |
| joined_no_student_match | 2 |
| chosen_converted_student_ids | 5 |
| rows_with_import_blockers | 101 |

Duplicate candidate groups: []. These are flagged for review, never silently removed.

## Exact headers and populated columns

Empty source headers are distinguished from generated JSON keys; counts exclude only explicitly identified non-data legend rows.

| Excel column | Exact source header | Audit JSON key | Populated rows |
| --- | --- | --- | --- |
| A | "Column1" | Column1 | 5 |
| B | "Origin" | Origin | 1 |
| C | "Name" | Name | 101 |
| D | "furigana" | furigana | 23 |
| E | "PC" | PC | 2 |
| F | "Joined" | Joined | 22 |
| G | "mail" | mail | 93 |
| H | "phone" | phone | 93 |
| I | "how they reached out" | how they reached out | 91 |
| J | "day of taiken" | day of taiken | 95 |
| K | "Time of Taiken" | Time of Taiken | 86 |
| L | "name of student 1" | name of student 1 | 13 |
| M | "name of student 2" | name of student 2 | 0 |
| N | "Age group S1" | Age group S1 | 81 |
| O | "Level S1" | Level S1 | 10 |
| P | "コース" | コース | 42 |
| Q | "Level s2" | Level s2 | 0 |
| R | "Request" | Request | 8 |
| S | "How they know Bee" | How they know Bee | 66 |
| T | "Type of lesson" | Type of lesson | 19 |
| U | "notes" | notes | 61 |
| V | "Teacher" | Teacher | 34 |
| W | "Joined2" | Joined2 | 8 |
| X | "refusal date" | refusal date | 2 |
| Y | "FP" | FP | 3 |
| Z | "Date received" | Date received | 0 |
| AA | "adress" | adress | 41 |
| AB | (blank) | Column28 | 0 |
| AC | (blank) | Column29 | 0 |
| AD | (blank) | Column30 | 0 |
| AE | (blank) | Column31 | 0 |
| AF | (blank) | Column32 | 0 |
| AG | (blank) | Column33 | 0 |
| AH | (blank) | Column34 | 0 |
| AI | (blank) | Column35 | 0 |
| AJ | (blank) | Column36 | 0 |
| AK | (blank) | Column37 | 0 |
| AL | (blank) | Column38 | 0 |
| AM | (blank) | Column39 | 0 |
| AN | (blank) | Column40 | 0 |
| AO | (blank) | Column41 | 0 |
| AP | (blank) | Column42 | 0 |
| AQ | (blank) | Column43 | 0 |
| AR | (blank) | Column44 | 0 |
| AS | (blank) | Column45 | 0 |
| AT | (blank) | Column46 | 0 |

## Every categorical raw value and proposed mapping

Null mappings remain unresolved or blank. Numeric raw values remain numbers in JSON; no unexplained code is treated as CustomerID.

### Column1

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 103 | 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 105, 107, 108, 109 | (see status evidence / staging only) |
| "J" | 2 | 2, 3 | (see status evidence / staging only) |
| "y" | 2 | 104, 106 | (see status evidence / staging only) |
| "j" | 1 | 5 | (see status evidence / staging only) |

### Origin

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 107 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108 | (see status evidence / staging only) |
| "BOOKING SOURCE: KIDS CAMPAIGN\r\nTRIAL TYPE: FREE" | 1 | 109 | (see status evidence / staging only) |

### PC

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 106 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (see status evidence / staging only) |
| "yes" | 2 | 80, 81 | (see status evidence / staging only) |

### Joined

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 86 | 4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 29, 31, 34, 35, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 50, 51, 52, 55, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 88, 89, 90, 91, 92, 93, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (see status evidence / staging only) |
| "yes" | 15 | 2, 3, 27, 28, 32, 33, 49, 53, 57, 58, 59, 60, 61, 87, 94 | (see status evidence / staging only) |
| "n" | 3 | 30, 37, 48 | (see status evidence / staging only) |
| 45843 | 1 | 10 | (see status evidence / staging only) |
| "Yes" | 1 | 12 | (see status evidence / staging only) |
| "no" | 1 | 54 | (see status evidence / staging only) |
| 45934 | 1 | 56 | (see status evidence / staging only) |

### Joined2

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 100 | 4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 34, 35, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (see status evidence / staging only) |
| "yes" | 3 | 2, 3, 32 | (see status evidence / staging only) |
| "n" | 3 | 30, 33, 37 | (see status evidence / staging only) |
| 45843 | 1 | 10 | (see status evidence / staging only) |
| "Yes" | 1 | 12 | (see status evidence / staging only) |

### refusal date

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 106 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (see status evidence / staging only) |
| 45811 | 2 | 30, 33 | (see status evidence / staging only) |

### Teacher

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 74 | 7, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 26, 29, 30, 31, 33, 35, 36, 37, 38, 44, 46, 47, 48, 52, 53, 54, 55, 56, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (see status evidence / staging only) |
| "Alex" | 26 | 2, 3, 5, 6, 8, 22, 25, 32, 34, 39, 40, 42, 43, 49, 50, 51, 57, 58, 59, 93, 94, 95, 96, 97, 98, 100 | (see status evidence / staging only) |
| "Thomas" | 3 | 12, 23, 41 | (see status evidence / staging only) |
| "alex" | 2 | 27, 28 | (see status evidence / staging only) |
| "Pierre" | 2 | 45, 99 | (see status evidence / staging only) |
| "Nao" | 1 | 4 | (see status evidence / staging only) |

### how they reached out

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| "mail" | 38 | 2, 3, 6, 7, 8, 12, 17, 18, 19, 22, 25, 26, 27, 30, 31, 32, 33, 35, 36, 38, 39, 40, 42, 43, 45, 47, 49, 55, 62, 64, 65, 66, 67, 69, 77, 78, 107, 108 | email |
| "Phone" | 26 | 4, 5, 9, 10, 11, 14, 15, 16, 23, 29, 34, 37, 44, 46, 48, 57, 59, 60, 61, 68, 70, 76, 79, 80, 105, 106 | phone |
| (blank) | 17 | 13, 21, 52, 54, 56, 71, 72, 73, 74, 75, 84, 85, 86, 92, 93, 95, 109 | (unresolved/blank) |
| "Mail" | 15 | 81, 82, 83, 90, 91, 94, 96, 97, 98, 99, 100, 101, 102, 103, 104 | email |
| "phone" | 9 | 24, 50, 51, 53, 58, 63, 87, 88, 89 | phone |
| "drop-by" | 2 | 28, 41 | walk_in |
| "riekorange1123@icloud.com" | 1 | 20 | (unresolved/blank) |

### How they know Bee

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 42 | 9, 12, 13, 14, 15, 16, 24, 29, 37, 39, 46, 47, 48, 52, 54, 55, 56, 59, 63, 67, 71, 73, 74, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 101, 103, 105, 107, 108 | (unresolved/blank) |
| "ホームページ" | 36 | 6, 7, 8, 10, 17, 18, 19, 20, 21, 22, 25, 27, 28, 30, 31, 32, 35, 36, 40, 41, 42, 43, 44, 49, 50, 93, 94, 95, 96, 97, 98, 99, 100, 102, 104, 106 | bee_school_website |
| "homepage" | 12 | 57, 58, 62, 64, 65, 66, 69, 70, 72, 75, 76, 77 | bee_school_website |
| "知り合い" | 7 | 33, 34, 38, 45, 60, 61, 68 | referral |
| "知り合い・友人の紹介" | 2 | 2, 3 | referral |
| "x" | 2 | 4, 5 | (unresolved/blank) |
| "その他" | 2 | 26, 90 | other |
| "baby" | 2 | 51, 53 | (unresolved/blank) |
| "Google map" | 1 | 11 | google_maps |
| "la mere est bien conne" | 1 | 23 | (unresolved/blank) |
| "Kids campaign" | 1 | 109 | (unresolved/blank) |

### Type of lesson

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 89 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 23, 24, 29, 32, 33, 35, 36, 37, 39, 44, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108 | (unresolved/blank) |
| "グループ" | 10 | 27, 28, 30, 34, 38, 40, 41, 42, 43, 45 | group |
| "group" | 2 | 22, 25 | group |
| "Group" | 1 | 18 | group |
| "generally/they coild not find the place" | 1 | 19 | (unresolved/blank) |
| "Private / SP" | 1 | 20 | (unresolved/blank) |
| "semi-private/sp" | 1 | 21 | (unresolved/blank) |
| "両方" | 1 | 26 | (unresolved/blank) |
| "プライベート" | 1 | 31 | private |
| "プライベートレッスン" | 1 | 109 | private |

### Age group S1

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 27 | 9, 12, 15, 20, 24, 25, 28, 29, 39, 44, 46, 47, 48, 51, 53, 54, 55, 56, 59, 60, 61, 66, 74, 84, 86, 89, 92 | (unresolved/blank) |
| "小学生" | 23 | 3, 21, 22, 27, 30, 31, 34, 35, 40, 42, 43, 50, 57, 58, 67, 68, 69, 76, 94, 96, 97, 101, 103 | elementary |
| "幼稚園" | 15 | 5, 17, 18, 32, 33, 38, 49, 62, 64, 83, 85, 91, 93, 98, 100 | kindergarten |
| "中学生" | 8 | 26, 72, 77, 95, 99, 102, 104, 105 | junior_high |
| "大人" | 7 | 75, 78, 79, 80, 81, 82, 90 | adult |
| "high school" | 3 | 19, 23, 70 | high_school |
| "Adult" | 3 | 36, 37, 63 | adult |
| "Junior High" | 3 | 41, 52, 65 | junior_high |
| "高校生" | 3 | 71, 87, 88 | high_school |
| "小学2年" | 2 | 10, 14 | elementary |
| "\\" | 1 | 2 | (unresolved/blank) |
| "Chu 1" | 1 | 4 | junior_high |
| "小学2年生が2人と\r\n年長が1人" | 1 | 6 | (unresolved/blank) |
| "高校生 / Canceled same day" | 1 | 7 | (unresolved/blank) |
| "Canceled same day" | 1 | 8 | (unresolved/blank) |
| "小学2年 and adult" | 1 | 11 | (unresolved/blank) |
| "Adutls and kid" | 1 | 13 | (unresolved/blank) |
| "baby - Nenchuu" | 1 | 16 | (unresolved/blank) |
| "キッズ" | 1 | 45 | (unresolved/blank) |
| "幼稚園/小学生" | 1 | 73 | (unresolved/blank) |
| 19 | 1 | 106 | (unresolved/blank) |
| 4 | 1 | 107 | (unresolved/blank) |
| 6 | 1 | 108 | (unresolved/blank) |
| 23 | 1 | 109 | (unresolved/blank) |

### Level S1

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 98 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 32, 33, 36, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (unresolved/blank) |
| "キッズ" | 9 | 27, 28, 29, 30, 31, 34, 35, 39, 40 | (unresolved/blank) |
| "初級" | 1 | 26 | (unresolved/blank) |

### Level s2

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 108 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (unresolved/blank) |

### コース

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 66 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 44, 46, 47, 48, 52, 54, 55, 56, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 74, 78, 80, 84, 89, 92, 106, 107, 108 | (unresolved/blank) |
| "グループ" | 28 | 40, 41, 42, 43, 45, 49, 50, 51, 53, 57, 58, 73, 83, 85, 88, 90, 91, 93, 94, 95, 96, 97, 98, 100, 101, 103, 104, 105 | group |
| "プライベート" | 6 | 75, 82, 86, 87, 99, 102 | private |
| "セミプライベート" | 3 | 71, 77, 79 | (unresolved/blank) |
| "よく分からない" | 2 | 39, 81 | (unresolved/blank) |
| "小学生" | 2 | 72, 76 | (unresolved/blank) |
| "プライベートレッスン" | 1 | 109 | private |

### FP

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 105 | 2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (see status evidence / staging only) |
| 36980 | 1 | 5 | (see status evidence / staging only) |
| "Colors" | 1 | 6 | (see status evidence / staging only) |
| "Yellow: Communication in process" | 1 | 7 | (see status evidence / staging only) |

### Date received

| Raw value | Count | Source rows | Proposed canonical value |
| --- | --- | --- | --- |
| (blank) | 108 | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109 | (see status evidence / staging only) |

## Status interpretation and Student correlations

Explicit yes/Yes proposes Joined, unless another Joined column or refusal date conflicts. Explicit no/n proposes Did not join. Refusal dates preserve non-conversion evidence. Date-only Joined cells are review candidates, not confirmed conversions. Exact cancellation phrases propose Cancelled. Blank outcomes remain unresolved; dates alone never establish attendance.

| Proposed status | Rows |
| --- | --- |
| joined | 17 |
| unresolved | 85 |
| cancelled | 2 |
| did_not_join | 4 |

### Joined versus current Student matches

| Raw value | Count | A strong | B ambiguous | C no match |
| --- | --- | --- | --- | --- |
| (blank) | 86 | 6 | 10 | 70 |
| "yes" | 15 | 5 | 9 | 1 |
| "n" | 3 | 0 | 1 | 2 |
| 45843 | 1 | 0 | 1 | 0 |
| "Yes" | 1 | 0 | 0 | 1 |
| "no" | 1 | 0 | 0 | 1 |
| 45934 | 1 | 0 | 1 | 0 |

### Joined2 versus current Student matches

| Raw value | Count | A strong | B ambiguous | C no match |
| --- | --- | --- | --- | --- |
| (blank) | 100 | 9 | 18 | 73 |
| "yes" | 3 | 2 | 1 | 0 |
| "n" | 3 | 0 | 2 | 1 |
| 45843 | 1 | 0 | 1 | 0 |
| "Yes" | 1 | 0 | 0 | 1 |

### refusal date versus current Student matches

| Raw value | Count | A strong | B ambiguous | C no match |
| --- | --- | --- | --- | --- |
| (blank) | 106 | 11 | 20 | 75 |
| 45811 | 2 | 0 | 2 | 0 |

## Proposed exact Student UUID links

A requires one exact legacy ID if reliably available, or exact normalized email/phone plus an exact compatible identity. Names alone and shared/contradictory identities remain B. No reliable CustomerID exists in this Taiken sheet. Named participant identities take precedence over contact-person names. No Students will be created or merged.

| Source row | Existing Student UUID | Converted UUID to write | Evidence | Student profile |
| --- | --- | --- | --- | --- |
| 2 | 6a179773-55ff-4ff4-8753-9f61bef9ff3e | 6a179773-55ff-4ff4-8753-9f61bef9ff3e | email + exact_name | /students/profile/?id=6a179773-55ff-4ff4-8753-9f61bef9ff3e |
| 3 | c4a25321-1cb3-4ab4-8bd2-b769b35e85ff | c4a25321-1cb3-4ab4-8bd2-b769b35e85ff | email + exact_name | /students/profile/?id=c4a25321-1cb3-4ab4-8bd2-b769b35e85ff |
| 49 | 392ea0a0-1674-4d74-afa3-83670bc37c3b | 392ea0a0-1674-4d74-afa3-83670bc37c3b | email + exact_name | /students/profile/?id=392ea0a0-1674-4d74-afa3-83670bc37c3b |
| 60 | 2d812ef4-85b6-45ca-8e74-4facaaf70419 | 2d812ef4-85b6-45ca-8e74-4facaaf70419 | email + phone + exact_name | /students/profile/?id=2d812ef4-85b6-45ca-8e74-4facaaf70419 |
| 61 | 2bc43681-d960-42f9-82d8-8b6d65c6742f | 2bc43681-d960-42f9-82d8-8b6d65c6742f | email + phone + exact_name | /students/profile/?id=2bc43681-d960-42f9-82d8-8b6d65c6742f |

### Every Joined candidate requiring review

| Row | Joined | Joined2 | Category | Candidate UUIDs and signals | Outcome evidence |
| --- | --- | --- | --- | --- | --- |
| 2 | "yes" | "yes" | A | 6a179773-55ff-4ff4-8753-9f61bef9ff3e (email + exact_name) | explicit_yes_in_joined_field |
| 3 | "yes" | "yes" | A | c4a25321-1cb3-4ab4-8bd2-b769b35e85ff (email + exact_name) | explicit_yes_in_joined_field |
| 10 | 45843 | 45843 | B | 2d8d0aba-4098-4360-b699-1c84ee895b8e (phone) | date_in_joined_field_requires_owner_confirmation |
| 12 | "Yes" | "Yes" | C | (none) | explicit_yes_in_joined_field |
| 27 | "yes" | (blank) | C | (none) | explicit_yes_in_joined_field |
| 28 | "yes" | (blank) | B | 85339dc2-5b8d-4b34-86ec-fef6d7560d13 (email) | explicit_yes_in_joined_field |
| 32 | "yes" | "yes" | B | bc4a235a-dadc-4252-97e9-50eba49b81b9 (email + phone) | explicit_yes_in_joined_field |
| 33 | "yes" | "n" | B | 100d1748-0361-457e-92b5-9f9e9cbcdcc3 (email + phone) | conflicting_or_unknown_conversion_evidence |
| 49 | "yes" | (blank) | A | 392ea0a0-1674-4d74-afa3-83670bc37c3b (email + exact_name) | explicit_yes_in_joined_field |
| 53 | "yes" | (blank) | B | 1e540b83-bffd-4320-bbc2-afd460e38d35 (phone) | explicit_yes_in_joined_field |
| 56 | 45934 | (blank) | B | 140f0782-c521-4b91-9434-4992cf684004 (email + phone) | date_in_joined_field_requires_owner_confirmation |
| 57 | "yes" | (blank) | B | 24c844ab-a8ee-4c64-b06f-836bd301d70e (email + phone) | explicit_yes_in_joined_field |
| 58 | "yes" | (blank) | B | 5a8461d6-0e9d-4544-b5d6-e200ee9b6822 (email + phone) | explicit_yes_in_joined_field |
| 59 | "yes" | (blank) | B | 82a8ac3b-857e-4252-9fcc-685bd8346054 (email + phone) | explicit_yes_in_joined_field |
| 60 | "yes" | (blank) | A | 2d812ef4-85b6-45ca-8e74-4facaaf70419 (email + phone + exact_name) | explicit_yes_in_joined_field |
| 61 | "yes" | (blank) | A | 2bc43681-d960-42f9-82d8-8b6d65c6742f (email + phone + exact_name) | explicit_yes_in_joined_field |
| 87 | "yes" | (blank) | B | fa8a91e1-9137-4dd1-bcb0-24627030e6dd (email + phone) | explicit_yes_in_joined_field |
| 94 | "yes" | (blank) | B | ac6896de-65ee-4a3c-8345-417086d48bd7 (email) | explicit_yes_in_joined_field |

## Refusal date patterns

| Raw value | Count | Pattern | Parsed historical date |
| --- | --- | --- | --- |
| (blank) | 106 | blank | (none) |
| 45811 | 2 | Excel date serial | 2025-06-03 |

## Teachers

No alias-to-profile mapping is inferred from a first name. Only owner-supplied exact raw mappings to a currently eligible Ohashi profile are accepted.

Approved mappings supplied: {}.

| Existing profile UUID | Name | Eligible Ohashi teacher |
| --- | --- | --- |
| 783d98f9-7e43-48e5-a81e-feead2fc223d | pierre@beeschool.jp | yes |

## Production fields proposed

| Source | Existing production target | Rule |
| --- | --- | --- |
| Name | prospects.japanese_name; alphabet_name only for Latin-script source names | Preserve contact name as written. Missing required name blocks production. |
| furigana | prospects.furigana | Kana-only names; other values retained in raw staging for review. |
| mail / phone | prospect_contacts rows: contact_type, value, label, is_primary | Valid normalized email/phone only; invalid originals retained in raw staging. |
| how they reached out | prospects.inquiry_method_id | Exact canonical value or obvious approved-in-code alias; unknown stays null. |
| How they know Bee | prospects.acquisition_source_id | Independent acquisition mapping; no collapse into inquiry method. |
| day of taiken / Time of Taiken | trial_lessons.trial_date / trial_time | Strict validated calendar date and time; missing/invalid blocks current production schema. |
| Type of lesson / コース | trial_lessons.lesson_type | Explicit group/private only. Clear course type used only when Type of lesson is blank; conflicting values block. |
| Age group S1 | trial_lessons.level_id; named participant 1 age_group_level_id | Exact canonical age-group mapping only, no inference from numeric age. |
| Level S1 / Level s2 | trial_lesson_participants.requested_level_id | Existing canonical class_levels only; no new levels. |
| name of student 1 / name of student 2 | trial_lesson_participants rows: japanese_name, alphabet_name, furigana, age_group_level_id, requested_level_id, converted_student_id | One row per explicit named participant; missing names and mixed households require review. |
| Request / notes | trial_lessons.customer_request / internal_notes | Preserve original values; no address copied into either field. |
| Teacher | trial_lessons.assigned_teacher_profile_id | Explicit owner mapping to eligible Ohashi teacher only; otherwise null. |
| Joined / Joined2 / refusal date | trial_lessons.status | See per-row status evidence and correlations. Never infer completed from a historical scheduled date. |
| existing Student match | trial_lessons.converted_student_id; named participant converted_student_id | A only plus confirmed conversion; no Student creation, merge or update. |
| adress / address | raw_source_data only | Never include postal address in production candidates. |
| Bee School HQ / Ohashi | organization_id / school_id on all rows | Resolve IDs by exact names in live DB; parent IDs attached transactionally by a future approved import. |
| Column1 / Origin / PC / FP / Date received / unmapped source values | raw_source_data only | No guessed semantics or fabricated stable CustomerID. |

All prospective rows include organization_id and school_id. A future approved transaction would generate IDs and attach prospect_contacts.prospect_id, trial_lessons.prospect_id and trial_lesson_participants.trial_lesson_id. Each row's exact candidate values are in the companion JSON. Postal adress/address remains only in raw_source_data; no Student/Auth writes are proposed.

## Required-field and business-review blockers

| Blocker | Rows |
| --- | --- |
| missing_or_unresolved_trial_time | 28 |
| missing_or_unresolved_lesson_type | 64 |
| missing_or_unresolved_level_id | 40 |
| missing_prospect_name | 7 |
| attendance_or_outcome_not_recorded | 84 |
| participant_household_needs_review | 6 |
| date_in_joined_field_requires_owner_confirmation | 2 |
| missing_or_unresolved_trial_date | 19 |
| conflicting_or_unknown_conversion_evidence | 1 |

- Column1 J/j/y, PC, FP and Origin have no approved business meaning; staging only.

- Joined and Joined2 mix yes/no/n and Excel date serials; explicit yes establishes conversion, date-only positives require owner confirmation. Blank does not establish attendance or outcome.

- Legacy Teacher aliases need exact owner-approved profile UUID mappings; no users are created.

- Missing schedules, canonical class level/type and unknown outcomes cannot satisfy current required Trial Lesson fields; no invented values.

- Participant names are frequently absent or embedded in household descriptions. Contact Name is not automatically duplicated as a participant; review unnamed or multiple-person records.

- Level S1 キッズ/初級 and ambiguous age/course/type text have no exact canonical match.

- Misplaced notes in furigana and acquisition/inquiry columns remain raw audit data pending review.

- Historical refusal date has no dedicated production field; retained in staging pending an approved existing-notes representation.

## Row-by-row audit

| Source row | Date | Time | Status | Participants | Match category | Chosen Student UUID | Warnings / blockers |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 2025-01-09 | (blank) | joined | 0 | A | 6a179773-55ff-4ff4-8753-9f61bef9ff3e | invalid_phone: phone; participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; unresolved_legacy_business_meaning: Column1; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 3 | 2025-01-09 | (blank) | joined | 0 | A | c4a25321-1cb3-4ab4-8bd2-b769b35e85ff | invalid_phone: phone; participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; unresolved_legacy_business_meaning: Column1; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type |
| 4 | 2025-01-07 | (blank) | unresolved | 1 | not_applicable | (blank) | invalid_phone: phone; unresolved_acquisition_source: How they know Bee; participant_name_may_be_incomplete: name of student 1; teacher_requires_exact_approved_mapping: Teacher; missing_prospect_name; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type |
| 5 | 2025-01-16 | (blank) | unresolved | 1 | not_applicable | (blank) | invalid_phone: phone; unresolved_acquisition_source: How they know Bee; participant_name_may_be_incomplete: name of student 1; teacher_requires_exact_approved_mapping: Teacher; unresolved_legacy_business_meaning: Column1; unresolved_legacy_business_meaning: FP; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type |
| 6 | 2025-02-01 | 14:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; multiple_participants_require_identity_review: name of student 1 / Age group S1 / notes; unresolved_legacy_business_meaning: FP; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id; participant_household_needs_review |
| 7 | 2025-01-18 | (blank) | cancelled | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; unresolved_legacy_business_meaning: FP; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 8 | 2025-01-30 | 17:00:00 | cancelled | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 9 | 2025-02-01 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 10 | 2025-02-08 | 11:00:00 | joined | 1 | B | (blank) | participant_name_may_be_incomplete: name of student 1; date_in_joined_field_requires_owner_confirmation; missing_or_unresolved_lesson_type |
| 11 | 2025-02-12 | 13:30:00 | unresolved | 2 | not_applicable | (blank) | multiple_names_in_participant_cell: name of student 1; unresolved_participant_age_group: Age group S1; participant_name_may_be_incomplete: name of student 1; participant_name_may_be_incomplete: name of student 1; multiple_participants_require_identity_review: name of student 1 / Age group S1 / notes; participant_household_needs_review; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 12 | 2025-02-17 | 17:00:00 | joined | 0 | C | (blank) | teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 13 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; multiple_participants_require_identity_review: name of student 1 / Age group S1 / notes; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id; participant_household_needs_review |
| 14 | 2025-02-21 | 17:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 15 | 2025-02-22 | 13:00:00 | unresolved | 2 | not_applicable | (blank) | multiple_names_in_participant_cell: name of student 1; participant_name_may_be_incomplete: name of student 1; multiple_participants_require_identity_review: name of student 1 / Age group S1 / notes; missing_prospect_name; participant_household_needs_review; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 16 | 2025-03-01 | 10:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 17 | 2025-03-03 | 16:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 18 | 2025-03-12 | 16:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 19 | 2025-03-19 | 20:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 20 | 2025-04-02 | 15:00:00 | unresolved | 0 | not_applicable | (blank) | unresolved_inquiry_method: how they reached out; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 21 | 2025-03-25 | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; invalid_trial_time: Time of Taiken; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type |
| 22 | 2025-03-24 | (blank) | unresolved | 0 | not_applicable | (blank) | invalid_phone: phone; participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; invalid_trial_time: Time of Taiken; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time |
| 23 | 2025-03-22 | (blank) | unresolved | 0 | not_applicable | (blank) | invalid_phone: phone; unresolved_acquisition_source: How they know Bee; participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; invalid_trial_time: Time of Taiken; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type |
| 24 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 25 | 2025-03-31 | 17:00:00 | unresolved | 0 | not_applicable | (blank) | teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_level_id |
| 26 | 2025-04-02 | 17:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 27 | 2025-04-12 | 11:00:00 | joined | 0 | C | (blank) | invalid_phone: phone; participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1 |
| 28 | 2025-04-08 | 18:00:00 | joined | 0 | B | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; missing_or_unresolved_level_id |
| 29 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 30 | 2025-04-16 | 17:00:00 | did_not_join | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1 |
| 31 | 2025-04-17 | 16:00:00 | unresolved | 0 | not_applicable | (blank) | invalid_phone: phone; participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 32 | (blank) | 16:00:00 | joined | 1 | B | (blank) | participant_name_may_be_incomplete: name of student 1; teacher_requires_exact_approved_mapping: Teacher; invalid_trial_date: day of taiken; missing_or_unresolved_trial_date; missing_or_unresolved_lesson_type |
| 33 | (blank) | 16:30:00 | unresolved | 0 | B | (blank) | participant_details_without_explicit_name: name of student 1; invalid_trial_date: day of taiken; no_explicit_participant_name: name of student 1; conflicting_or_unknown_conversion_evidence; missing_or_unresolved_trial_date; missing_or_unresolved_lesson_type |
| 34 | 2025-04-26 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 35 | (blank) | 16:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; invalid_trial_date: day of taiken; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_lesson_type |
| 36 | (blank) | 12:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; invalid_trial_date: day of taiken; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_lesson_type |
| 37 | 2025-05-14 | 16:30:00 | did_not_join | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; missing_or_unresolved_lesson_type |
| 38 | 2025-05-24 | 12:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 39 | 2025-05-31 | 16:00:00 | unresolved | 0 | not_applicable | (blank) | invalid_phone: phone; participant_details_without_explicit_name: name of student 1; unresolved_course: コース; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 40 | 2025-06-07 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | furigana_contains_unverified_name_or_notes: furigana; participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 41 | 2025-05-03 | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; invalid_trial_time: Time of Taiken; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time |
| 42 | 2025-07-12 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 43 | 2025-06-14 | 18:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 44 | 2025-07-19 | 13:00:00 | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 45 | 2025-07-12 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_level_id |
| 46 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 47 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 48 | 2025-07-17 | 18:00:00 | did_not_join | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 49 | 2025-07-19 | 10:00:00 | joined | 0 | A | 392ea0a0-1674-4d74-afa3-83670bc37c3b | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1 |
| 50 | 2025-07-17 | 17:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 51 | 2025-08-02 | 10:00:00 | unresolved | 0 | not_applicable | (blank) | unresolved_acquisition_source: How they know Bee; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_level_id |
| 52 | 2025-08-04 | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type |
| 53 | 2025-08-09 | 15:00:00 | joined | 0 | B | (blank) | unresolved_acquisition_source: How they know Bee; no_explicit_participant_name: name of student 1; missing_or_unresolved_level_id |
| 54 | 2025-08-12 | 11:30:00 | did_not_join | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 55 | 2025-08-23 | 13:30:00 | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 56 | (blank) | (blank) | joined | 0 | B | (blank) | furigana_contains_unverified_name_or_notes: furigana; no_explicit_participant_name: name of student 1; date_in_joined_field_requires_owner_confirmation; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 57 | 2025-09-02 | 16:30:00 | joined | 1 | B | (blank) | participant_name_may_be_incomplete: name of student 1; teacher_requires_exact_approved_mapping: Teacher |
| 58 | 2025-09-02 | 16:30:00 | joined | 1 | B | (blank) | participant_name_may_be_incomplete: name of student 1; teacher_requires_exact_approved_mapping: Teacher |
| 59 | 2025-09-06 | 12:30:00 | joined | 0 | B | (blank) | teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 60 | 2025-09-03 | (blank) | joined | 0 | A | 2d812ef4-85b6-45ca-8e74-4facaaf70419 | no_explicit_participant_name: name of student 1; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 61 | 2025-09-03 | (blank) | joined | 0 | A | 2bc43681-d960-42f9-82d8-8b6d65c6742f | no_explicit_participant_name: name of student 1; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 62 | 2025-09-06 | 10:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; missing_prospect_name; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 63 | 2025-09-17 | 13:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 64 | 2025-09-24 | 17:00:00 | unresolved | 1 | not_applicable | (blank) | participant_name_may_be_incomplete: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 65 | 2025-09-27 | 16:00:00 | unresolved | 1 | not_applicable | (blank) | participant_name_may_be_incomplete: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 66 | 2025-09-25 | 16:30:00 | unresolved | 1 | not_applicable | (blank) | participant_name_may_be_incomplete: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 67 | 2025-09-29 | 17:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 68 | 2025-11-01 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 69 | 2025-11-08 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 70 | 2025-11-11 | 18:00:00 | unresolved | 1 | not_applicable | (blank) | participant_name_may_be_incomplete: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 71 | 2025-12-10 | 19:00:00 | unresolved | 0 | not_applicable | (blank) | furigana_contains_unverified_name_or_notes: furigana; participant_details_without_explicit_name: name of student 1; unresolved_course: コース; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 72 | 2025-12-01 | 19:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; unresolved_course: コース; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 73 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | furigana_contains_unverified_name_or_notes: furigana; participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; multiple_participants_require_identity_review: name of student 1 / Age group S1 / notes; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_level_id; participant_household_needs_review |
| 74 | 2025-12-06 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | invalid_phone: phone; furigana_contains_unverified_name_or_notes: furigana; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 75 | 2025-12-13 | 13:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 76 | 2026-01-08 | 17:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; unresolved_course: コース; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 77 | 2026-01-08 | 17:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; unresolved_course: コース; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 78 | 2026-01-17 | 13:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 79 | 2026-01-29 | 12:30:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; unresolved_course: コース; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 80 | 2026-01-27 | 14:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; unresolved_legacy_business_meaning: PC; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 81 | 2026-01-29 | 16:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; unresolved_course: コース; no_explicit_participant_name: name of student 1; unresolved_legacy_business_meaning: PC; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type |
| 82 | 2026-01-31 | 15:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 83 | 2026-01-31 | 14:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 84 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 85 | 2026-01-31 | 10:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 86 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_level_id |
| 87 | 2026-03-02 | 19:30:00 | joined | 1 | B | (blank) | participant_name_may_be_incomplete: name of student 1 |
| 88 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; missing_prospect_name; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time |
| 89 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; missing_prospect_name; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 90 | 2026-03-16 | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time |
| 91 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time |
| 92 | (blank) | (blank) | unresolved | 0 | not_applicable | (blank) | no_explicit_participant_name: name of student 1; missing_prospect_name; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date; missing_or_unresolved_trial_time; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 93 | 2026-03-28 | 10:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; multiple_participants_require_identity_review: name of student 1 / Age group S1 / notes; attendance_or_outcome_not_recorded; participant_household_needs_review |
| 94 | 2026-03-28 | 11:00:00 | joined | 0 | B | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1 |
| 95 | 2026-04-08 | 13:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 96 | (blank) | 11:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; invalid_trial_date: day of taiken; no_explicit_participant_name: name of student 1; missing_prospect_name; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date |
| 97 | (blank) | 16:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; invalid_trial_date: day of taiken; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_date |
| 98 | 2026-04-22 | 16:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 99 | 2026-04-28 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 100 | 2026-05-12 | 15:00:00 | unresolved | 0 | not_applicable | (blank) | furigana_contains_unverified_name_or_notes: furigana; participant_details_without_explicit_name: name of student 1; teacher_requires_exact_approved_mapping: Teacher; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 101 | 2026-05-23 | 11:00:00 | unresolved | 0 | not_applicable | (blank) | furigana_contains_unverified_name_or_notes: furigana; participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 102 | 2026-06-18 | (blank) | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; invalid_trial_time: Time of Taiken; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time |
| 103 | 2026-07-06 | 16:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 104 | 2026-06-15 | (blank) | unresolved | 0 | not_applicable | (blank) | furigana_contains_unverified_name_or_notes: furigana; participant_details_without_explicit_name: name of student 1; invalid_trial_time: Time of Taiken; no_explicit_participant_name: name of student 1; unresolved_legacy_business_meaning: Column1; attendance_or_outcome_not_recorded; missing_or_unresolved_trial_time |
| 105 | 2026-07-14 | 16:00:00 | unresolved | 0 | not_applicable | (blank) | furigana_contains_unverified_name_or_notes: furigana; participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded |
| 106 | 2026-07-15 | 17:30:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; unresolved_legacy_business_meaning: Column1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 107 | 2026-08-03 | 13:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 108 | 2026-08-10 | 17:00:00 | unresolved | 0 | not_applicable | (blank) | participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; attendance_or_outcome_not_recorded; missing_or_unresolved_lesson_type; missing_or_unresolved_level_id |
| 109 | 2026-09-01 | 13:00:00 | unresolved | 0 | not_applicable | (blank) | unresolved_acquisition_source: How they know Bee; participant_details_without_explicit_name: name of student 1; no_explicit_participant_name: name of student 1; unresolved_legacy_business_meaning: Origin; attendance_or_outcome_not_recorded; missing_or_unresolved_level_id |

## Staging and rerun safety

The unapplied migration extends legacy_student_import_batches and legacy_student_import_rows with import_kind=taiken. Source identity is school_id + source_file_sha256 + Taiken + source_row_number, enforced across batches. Raw source, normalized candidates, warnings, matching evidence, chosen existing UUIDs and future production receipts remain auditable. This dry run writes only these local reports. No production executor is exposed; a reviewed, atomic executor and resolution of historical required fields are still needed before importing.

## Excluded non-data rows

None. All populated source rows are preserved.

The reports contain personal data and remain in the ignored local taiken-audit directory.

## Implementation validation

- npm run lint: passed.
- npm run test: passed, including workbook isolation, matching, household safety and read-only database transport tests.
- npm run build: passed (37 static pages).
- Workbook SHA-256 rechecked and unchanged; all 108 source identities are unique.
- Staging migration was reviewed but remains unapplied; its database runtime behavior has not been exercised.
- No database writes, production import, deployment or push.
