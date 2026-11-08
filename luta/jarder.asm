; ===== JARDER: base do jogo de luta (SNES, 65816, WLA-DX) =====
; Controles: direcionais andam, Cima pula, Baixo agacha, qualquer botão de face (B/Y/A/X) dá um soco.
.MEMORYMAP
 DEFAULTSLOT 0
 SLOT 0 $8000 $8000
.ENDME
.ROMBANKSIZE $8000
.ROMBANKS 8
.EMPTYFILL $00

.SNESHEADER
 ID "JRDR"
 NAME "JARDER BASE          "
 LOROM
 SLOWROM
 CARTRIDGETYPE $00
 ROMSIZE $08
 SRAMSIZE $00
 COUNTRY $01
 LICENSEECODE $00
 VERSION $00
.ENDSNES

.SNESNATIVEVECTOR
 COP Dummy
 BRK Dummy
 ABORT Dummy
 NMI NmiHandler
 IRQ Dummy
.ENDNATIVEVECTOR

.SNESEMUVECTOR
 COP Dummy
 ABORT Dummy
 NMI Dummy
 RESET Start
 IRQBRK Dummy
.ENDEMUVECTOR


.DEFINE ST_IDLE 0
.DEFINE ST_WALK 1
.DEFINE ST_JUMP 2
.DEFINE ST_CROUCH 3
.DEFINE ST_PUNCH 4
.DEFINE ST_KICK 5
.DEFINE GROUND $CC00          ; chão em y = 204 (8.8)

.ENUM $00
 joy dw
 joyprev dw
 joynew dw
 nmiflag dw
 px dw
 pyfix dw
 vy dw
 state dw
 face dw
 jdir dw
 atimer dw
 ftick dw
 frame dw
 tmp dw
 pose_a dw
 pose_b dw
 vdst dw
 sadr dw
 rowc dw
 wide dw
 tmp2 dw
.ENDE

.include "build/sizes.inc"

.MACRO VRAM_DMA ARGS src, vaddr, size
 sep #$20
 .ACCU 8
 lda #$80
 sta $2115
 ldx #vaddr
 stx $2116
 lda #$01
 sta $4300
 lda #$18
 sta $4301
 ldx #src
 stx $4302
 lda #:src
 sta $4304
 ldx #size
 stx $4305
 lda #$01
 sta $420B
.ENDM

.MACRO CGRAM_DMA ARGS src, caddr, size
 sep #$20
 .ACCU 8
 stz $4300
 lda #caddr
 sta $2121
 lda #$22
 sta $4301
 ldx #src
 stx $4302
 lda #:src
 sta $4304
 ldx #size
 stx $4305
 lda #$01
 sta $420B
.ENDM

.BANK 0 SLOT 0
.ORG 0
.SECTION "Code" FORCE

Dummy:
 rti

.include "build/posetbl.inc"

ZeroWord: .dw 0

NmiHandler:
 rep #$30
 .ACCU 16
 .INDEX 16
 pha
 phx
 phy
 sep #$20
 .ACCU 8
 lda $4210                ; reconhece o NMI
 stz $2102                ; envia a cópia da OAM (sprites)
 stz $2103
 stz $4300
 lda #$04
 sta $4301
 ldx #$0200
 stx $4302
 stz $4304
 ldx #$0220
 stx $4305
 lda #$01
 sta $420B
 rep #$20
 .ACCU 16
 lda #$4000               ; envia a pose atual (8 linhas de 16 tiles) para a VRAM dos sprites
 sta vdst
 lda pose_a
 sta sadr
 sep #$20
 .ACCU 8
 lda #$80
 sta $2115
 lda #$01
 sta $4300
 lda #$18
 sta $4301
 lda pose_b
 sta $4304
 lda wide
 beq _r8
 lda #16
 bra _rset
_r8:
 lda #8
_rset:
 sta rowc
_prow:
 ldx vdst
 stx $2116
 ldx sadr
 stx $4302
 ldx #512
 stx $4305
 lda #$01
 sta $420B
 rep #$21
 .ACCU 16
 lda vdst
 adc #$0100
 sta vdst
 lda sadr
 clc
 adc #512
 sta sadr
 sep #$20
 .ACCU 8
 dec rowc
 bne _prow
_joywait:
 lda $4212                ; espera a leitura automática do controle
 and #$01
 bne _joywait
 rep #$20
 .ACCU 16
 lda $4218
 sta joy
 sep #$20
 .ACCU 8
 lda #$01
 sta nmiflag
 rep #$30
 .ACCU 16
 ply
 plx
 pla
 rti

Start:
 sei
 clc
 xce
 rep #$38
 .ACCU 16
 .INDEX 16
 ldx #$1FFF
 txs
 sep #$20
 .ACCU 8
 lda #$8F
 sta $2100                ; tela apagada durante a carga
 stz $4200
 ldx #1
_ppuclr:
 stz $2100,x
 inx
 cpx #$34
 bne _ppuclr
 ldx #1
_cpuclr:
 stz $4200,x
 inx
 cpx #$0E
 bne _cpuclr
 ; limpa a VRAM inteira (DMA com origem fixa)
 lda #$80
 sta $2115
 ldx #0
 stx $2116
 lda #$09
 sta $4300
 lda #$18
 sta $4301
 ldx #ZeroWord
 stx $4302
 stz $4304
 ldx #0
 stx $4305
 lda #$01
 sta $420B
 ; limpa a CGRAM
 stz $2121
 lda #$08
 sta $4300
 lda #$22
 sta $4301
 ldx #ZeroWord
 stx $4302
 stz $4304
 ldx #512
 stx $4305
 lda #$01
 sta $420B
 ; carrega cenário e sprites
 CGRAM_DMA BgPal, 0, 32
 CGRAM_DMA ObjPal, 128, 32
 VRAM_DMA BgTiles, $0000, BGT_SIZE
 VRAM_DMA BgMap, $3C00, 2048
 VRAM_DMA ShadowTiles, $5000, 2048   ; sombra na 2ª tabela de sprites
 ; OAM: todos os sprites fora da tela
 ldx #0
_oamclr:
 stz $0200,x
 lda #$F0
 sta $0201,x
 stz $0202,x
 stz $0203,x
 inx
 inx
 inx
 inx
 cpx #$0200
 bne _oamclr
 ldx #0
_oamhi:
 lda #$55                 ; todos com X = -256 (fora da tela)
 sta $0400,x
 inx
 cpx #$20
 bne _oamhi
 ; vídeo: modo 1, BG1 + sprites
 lda #$01
 sta $2105
 lda #$3C
 sta $2107                ; mapa do BG1 em $3C00
 stz $210B                ; tiles do BG1 em $0000
 lda #$A2
 sta $2101                ; sprites 32x32/64x64, tiles em $4000
 lda #$FF
 sta $210E
 lda #$03
 sta $210E                ; BG1 sobe 1 linha (compensa a linha oculta)
 lda #$11
 sta $212C                ; BG1 + sprites
 ; estado inicial
 rep #$30
 .ACCU 16
 .INDEX 16
 lda #128
 sta px
 lda #GROUND
 sta pyfix
 stz vy
 stz state
 stz face
 stz jdir
 stz atimer
 stz ftick
 stz frame
 stz joy
 stz joyprev
 stz nmiflag
 jsr SelectFrame           ; já prepara a primeira pose
 jsr BuildOAM
 sep #$20
 .ACCU 8
 lda #$0F
 sta $2100                ; liga a tela
 lda #$81
 sta $4200                ; NMI + leitura automática do controle
_frame:
 lda nmiflag              ; espera o próximo quadro
 beq _frame
 stz nmiflag
 rep #$30
 .ACCU 16
 .INDEX 16
 jsr InputEdges
 jsr Update
 jsr SelectFrame
 jsr BuildOAM
 inc ftick
 sep #$20
 .ACCU 8
 bra _frame

InputEdges:
 .ACCU 16
 lda joy
 eor joyprev
 and joy
 sta joynew
 lda joy
 sta joyprev
 rts

Update:
 .ACCU 16
 lda state
 cmp #ST_PUNCH
 beq _atk
 cmp #ST_KICK
 bne _notpunch
_atk:
 dec atimer
 bne _done
 stz state
_done:
 rts
_notpunch:
 lda state
 cmp #ST_JUMP
 bne _ground
 jmp _air
_ground:
 lda joy
 bit #$0800               ; Cima: pula
 beq _noup
 lda #$FA00               ; velocidade inicial -6 px/quadro
 sta vy
 lda #ST_JUMP
 sta state
 stz jdir
 lda joy
 bit #$0100
 beq _nr
 lda #1
 sta jdir
_nr:
 lda joy
 bit #$0200
 beq _nl
 lda #$FFFF
 sta jdir
_nl:
 rts
_noup:
 lda joynew
 bit #$C000               ; B, Y: soco
 beq _nopunch
 lda #ST_PUNCH
 sta state
 lda #14
 sta atimer
 rts
_nopunch:
 lda joynew
 bit #$00C0               ; A, X: chute
 beq _nokick
 lda #ST_KICK
 sta state
 lda #20
 sta atimer
 rts
_nokick:
 lda joy
 bit #$0400               ; Baixo: agacha
 beq _nodown
 lda #ST_CROUCH
 sta state
 rts
_nodown:
 lda joy
 bit #$0100               ; Direita
 beq _noright
 stz face
 lda #ST_WALK
 sta state
 lda px
 clc
 adc #2
 cmp #217
 bcc _sr
 lda #216
_sr:
 sta px
 rts
_noright:
 lda joy
 bit #$0200               ; Esquerda
 beq _idle
 lda #1
 sta face
 lda #ST_WALK
 sta state
 lda px
 sec
 sbc #2
 cmp #40
 bcs _sl
 lda #40
_sl:
 sta px
 rts
_idle:
 stz state
 rts
_air:
 lda vy                   ; gravidade
 clc
 adc #$0050
 sta vy
 lda pyfix
 clc
 adc vy
 sta pyfix
 lda jdir
 beq _noh
 bmi _lft
 lda px
 clc
 adc #2
 cmp #217
 bcc _s1
 lda #216
_s1:
 sta px
 bra _noh
_lft:
 lda px
 sec
 sbc #2
 cmp #40
 bcs _s2
 lda #40
_s2:
 sta px
_noh:
 lda pyfix
 cmp #GROUND
 bcc _stillair
 lda #GROUND              ; pousou
 sta pyfix
 stz vy
 stz state
_stillair:
 rts

SelectFrame:
 .ACCU 16
 lda state
 cmp #ST_WALK
 beq _walk
 cmp #ST_JUMP
 beq _jump
 cmp #ST_CROUCH
 beq _crouch
 cmp #ST_PUNCH
 beq _punch
 cmp #ST_KICK
 beq _kick
 lda ftick                ; parado: respira a cada 32 quadros
 lsr a
 lsr a
 lsr a
 lsr a
 lsr a
 and #1
 sta frame
 rts
_walk:
 lda ftick                ; andando: troca de pose a cada 8 quadros
 lsr a
 lsr a
 lsr a
 and #3
 clc
 adc #2
 sta frame
 rts
_jump:
 lda #6
 sta frame
 rts
_crouch:
 lda #7
 sta frame
 rts
_punch:
 lda #8
 sta frame
 rts
_kick:
 lda #9
 sta frame
 rts

BuildOAM:
 .ACCU 16
 lda frame
 asl a
 asl a
 tax                      ; X = pose * 4
 lda.w PoseTbl,x          ; endereço dos gráficos da pose
 sta pose_a
 lda.w PoseTbl+2,x        ; banco (byte baixo) e flag "larga" (byte alto)
 sta pose_b
 xba
 and #$00FF
 sta wide
 sep #$20
 .ACCU 8
 lda #$30                 ; prioridade 3, paleta 0
 ldy face
 beq _right
 lda #$70                 ; vira para a esquerda
_right:
 sta tmp
 lda pyfix+1
 sec
 sbc #122
 sta tmp2                 ; y do sprite de cima
 lda px                   ; sombra no chão: duas metades de 32x32 (sprites 4 e 5, 2ª tabela)
 sec
 sbc #32
 sta $0210
 lda px
 sta $0214
 lda #187
 sta $0211
 sta $0215
 stz $0212
 lda #4
 sta $0216
 lda #$31
 sta $0213
 sta $0217
 lda px
 cmp #32
 bcs _bs1
 lda #$51
 bra _bs2
_bs1:
 lda #$50
_bs2:
 sta $0401
 lda wide
 bne _wide
 ; ---- pose estreita (64x128): sprites 0 e 1 ----
 lda px
 sec
 sbc #32
 sta $0200
 sta $0204
 lda tmp2
 sta $0201
 clc
 adc #64
 sta $0205
 stz $0202
 lda #8
 sta $0206
 lda tmp
 sta $0203
 sta $0207
 lda #0                   ; sprites 2 e 3 escondidos
 sta $0208
 sta $020C
 lda #$F0
 sta $0209
 sta $020D
 lda px
 cmp #32
 bcs _n1
 lda #$5F
 bra _n2
_n1:
 lda #$5A
_n2:
 sta $0400
 bra _bdone
_wide:
 ; ---- pose larga (128x128): 4 sprites ----
 lda tmp2
 sta $0201
 sta $0209
 clc
 adc #64
 sta $0205
 sta $020D
 stz $0202
 lda #8
 sta $0206
 lda #$80
 sta $020A
 lda #$88
 sta $020E
 lda tmp
 sta $0203
 sta $0207
 sta $020B
 sta $020F
 lda face
 bne _wflip
 lda px                   ; esquerda do quadro em px-64, direita em px
 sec
 sbc #64
 sta $0200
 sta $0204
 lda px
 sta $0208
 sta $020C
 lda px
 cmp #64
 bcs _w1
 lda #$AF
 bra _w9
_w1:
 lda #$AA
 bra _w9
_wflip:
 lda px                   ; espelhado: a metade esquerda vai para a direita
 sta $0200
 sta $0204
 sec
 sbc #64
 sta $0208
 sta $020C
 lda px
 cmp #64
 bcs _w2
 lda #$FA
 bra _w9
_w2:
 lda #$AA
_w9:
 sta $0400
_bdone:
 rep #$30
 .ACCU 16
 rts
.ENDS

.BANK 1 SLOT 0
.ORG 0
.SECTION "GfxData" FORCE
BgPal: .incbin "build/bg_pal.bin"
ObjPal: .incbin "build/obj_pal.bin"
BgMap: .incbin "build/bg_map.bin"
BgTiles: .incbin "build/bg_tiles.bin"
ShadowTiles: .incbin "build/shadow.bin"
.ENDS

.include "build/poses.inc"
