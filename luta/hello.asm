.MEMORYMAP
 DEFAULTSLOT 0
 SLOT 0 $8000 $8000
.ENDME
.ROMBANKSIZE $8000
.ROMBANKS 1
.SNESHEADER
 ID "TEST"
 NAME "HELLO TOOLCHAIN     "
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
 COP EmptyHandler
 BRK EmptyHandler
 ABORT EmptyHandler
 NMI EmptyHandler
 IRQ EmptyHandler
.ENDNATIVEVECTOR
.SNESEMUVECTOR
 COP EmptyHandler
 ABORT EmptyHandler
 NMI EmptyHandler
 RESET Start
 IRQBRK EmptyHandler
.ENDEMUVECTOR
.BANK 0 SLOT 0
.ORG 0
.SECTION "Main" SEMIFREE
EmptyHandler:
 rti
Start:
 sei
 clc
 xce
 rep #$10
 sep #$20
 lda #$8F
 sta $2100        ; tela apagada
 stz $2121        ; CGRAM endereço 0
 lda #$1F         ; vermelho (15 bits: 0x001F)
 sta $2122
 lda #$00
 sta $2122
 lda #$0F
 sta $2100        ; liga a tela, brilho máximo
Loop:
 bra Loop
.ENDS
