#!/usr/bin/env bash
# Distill a MusicBrainz full-export dump down to a compact Spotify-id -> gender
# lookup for EVERY MusicBrainz artist that has a Spotify link. The result is a
# small local table you can query directly when enriching new artists, instead
# of crawling the rate-limited MusicBrainz API.
#
# Dump tables are Postgres COPY-format TSV, no headers, so column positions
# (from admin/sql/CreateTables.sql) are hard-coded:
#   url          $1=id            $3=url
#   l_artist_url $3=entity0(artist id)  $4=entity1(url id)
#   artist       $1=id            $13=gender(FK)
#   gender       $1=id            $2=name
#
# Output: $OUT  ->  spotify_id,gender   (every MB artist with a Spotify link + gender)
set -euo pipefail

WORK="${WORK:-/tmp/mbdump}"
TAR="${TAR:-$WORK/mbdump.tar.bz2}"
OUT="${OUT:-$WORK/mb_artist_gender.csv}"

if [ ! -f "$WORK/mbdump/artist" ]; then
	echo "[setup] extracting artist, gender, l_artist_url…"
	tar -xjf "$TAR" -C "$WORK" mbdump/artist mbdump/gender mbdump/l_artist_url
fi

echo "[1/3] streaming url table, keeping ALL Spotify-artist links…"
tar -xjOf "$TAR" mbdump/url | grep -F "open.spotify.com/artist/" > "$WORK/url_spotify.tsv"
echo "      spotify-artist urls: $(wc -l < "$WORK/url_spotify.tsv")"

echo "[2/3] reducing to id-keyed maps…"
# url_id -> spotify_id
awk -F'\t' '{ if (match($3, /artist\/[A-Za-z0-9]+/)) print $1"\t"substr($3, RSTART+7, RLENGTH-7) }' \
	"$WORK/url_spotify.tsv" > "$WORK/url2sid.tsv"
# l_artist_url rows pointing at a spotify url -> artist_id \t url_id
awk -F'\t' 'NR==FNR { u[$1]; next } ($4 in u) { print $3"\t"$4 }' \
	"$WORK/url2sid.tsv" "$WORK/mbdump/l_artist_url" > "$WORK/lau.tsv"
# those artists, with a non-null gender -> artist_id \t gender_id
awk -F'\t' 'NR==FNR { a[$1]; next } ($1 in a) && $13 != "\\N" { print $1"\t"$13 }' \
	"$WORK/lau.tsv" "$WORK/mbdump/artist" > "$WORK/artgender.tsv"

echo "[3/3] joining -> $OUT"
awk -F'\t' '
	BEGIN { fi = 0; print "spotify_id,gender" }
	FNR == 1 { fi++ }
	fi == 1 { gname[$1] = $2; next }                                  # gender:      id->name
	fi == 2 { u2s[$1] = $2; next }                                    # url2sid.tsv: url_id->sid
	fi == 3 { a2u[$1] = $2; next }                                    # lau.tsv:     artist_id->url_id
	fi == 4 {                                                         # artgender:   artist_id->gender_id
		sid = u2s[a2u[$1]]; g = tolower(gname[$2])
		if (sid != "" && g != "") print sid","g
	}
' "$WORK/mbdump/gender" "$WORK/url2sid.tsv" "$WORK/lau.tsv" "$WORK/artgender.tsv" > "$OUT"

echo "done: $(($(wc -l < "$OUT") - 1)) artists in the lookup -> $OUT"
